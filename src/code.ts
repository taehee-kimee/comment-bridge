import type {
  ImportComment,
  ImportPayload,
  CommentResult,
  FigmaAPIComment,
  FigmaClientMeta,
  ExportComment,
  ExportPayload,
  PluginMessage,
  UIMessage,
  NodePosition,
} from "./types";

// ── Constants ────────────────────────────────────────────────────────
const POST_IT_WIDTH = 280;
const CLUSTER_THRESHOLD = 16;
const STACK_STEP_Y = 12;
const PLACEMENT_OFFSET_X = 24;
const PLACEMENT_OFFSET_Y = -12;
const GROUP_FRAME_NAME = "🗒 Imported Comments (MVP)";
const UNPLACED_SECTION_NAME = "📌 Unplaced";
const TOKEN_STORAGE_KEY = "figmaToken";
const EXPORT_DATA_KEY = "savedExport";

// In-memory cache: originalCommentId → Figma node ID (for fast navigate)
const commentNodeMap = new Map<string, string>();

const COLORS = {
  bg: { r: 1, g: 0.96, b: 0.75 },
  shadow: { r: 0, g: 0, b: 0, a: 0.12 },
  authorText: { r: 0.25, g: 0.25, b: 0.25 },
  messageText: { r: 0.1, g: 0.1, b: 0.1 },
  replyAuthor: { r: 0.35, g: 0.35, b: 0.35 },
  replyText: { r: 0.2, g: 0.2, b: 0.2 },
  separator: { r: 0.82, g: 0.78, b: 0.6 },
  metaText: { r: 0.5, g: 0.5, b: 0.5 },
  groupBg: { r: 0.97, g: 0.97, b: 0.97 },
};

// ══════════════════════════════════════════════════════════════════════
//  Entry
// ══════════════════════════════════════════════════════════════════════

figma.showUI(__html__, { width: 440, height: 560, themeColors: true });

// Send init data to UI
(async () => {
  try {
    const [savedToken, savedExport] = await Promise.all([
      figma.clientStorage.getAsync(TOKEN_STORAGE_KEY),
      figma.clientStorage.getAsync(EXPORT_DATA_KEY),
    ]);
    const savedFileKey = figma.root.getPluginData("fileKey") || undefined;
    const detectedFileKey = savedFileKey ?? figma.fileKey ?? undefined;
    console.log("[Comment Bridge] init OK | fileKey:", detectedFileKey, "| hasToken:", !!savedToken, "| hasExport:", !!savedExport);
    sendToUI({
      type: "init",
      fileKey: detectedFileKey,
      savedToken: String(savedToken ?? ""),
      savedExport: (savedExport as string) ?? null,
    });
  } catch (e) {
    console.error("[Comment Bridge] INIT ERROR:", e);
    figma.notify("Init error: " + String(e), { error: true });
  }
})();

figma.ui.onmessage = async (msg: PluginMessage) => {
  try {
  switch (msg.type) {
    case "import-comments":
      try {
        await importComments(msg.payload);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message + " | stack: " + e.stack : String(e);
        console.error("[Comment Bridge] IMPORT ERROR:", errMsg);
        sendToUI({
          type: "import-error",
          error: errMsg,
        });
      }
      break;

    case "process-export":
      try {
        const result = processExport(msg.rawComments, msg.includeResolved, msg.nodePositions);
        const filename = `figma-comments-export-${todayStr()}.json`;
        sendToUI({
          type: "export-ready",
          json: JSON.stringify(result, null, 2),
          filename,
        });
      } catch (e: unknown) {
        sendToUI({
          type: "export-error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
      break;

    case "save-token":
      await figma.clientStorage.setAsync(TOKEN_STORAGE_KEY, msg.token);
      break;

    case "request-filekey":
      sendToUI({
        type: "filekey-response",
        fileKey: (figma.fileKey ?? figma.root.getPluginData("fileKey")) || undefined,
      });
      break;

    case "save-filekey":
      figma.root.setPluginData("fileKey", msg.fileKey);
      break;

    case "save-export":
      await figma.clientStorage.setAsync(EXPORT_DATA_KEY, msg.json);
      sendToUI({ type: "export-saved" });
      break;

    case "load-export": {
      const saved = (await figma.clientStorage.getAsync(EXPORT_DATA_KEY)) ?? null;
      sendToUI({ type: "export-load-result", json: saved as string | null, manual: !!msg.manual });
      break;
    }

    case "navigate-to-comment": {
      console.log("[Comment Bridge] navigate received:", msg.commentId, "| cache size:", commentNodeMap.size);
      let targetNode: BaseNode | null = null;

      // Fast path: in-memory cache
      const cachedNodeId = commentNodeMap.get(msg.commentId);
      if (cachedNodeId) {
        targetNode = figma.getNodeById(cachedNodeId);
        if (!targetNode) {
          // Node was deleted — clean up cache and notify immediately
          commentNodeMap.delete(msg.commentId);
          figma.notify("포스트잇이 삭제되었습니다.", { error: true });
          break;
        }
      }

      if (targetNode) {
        const page = findPage(targetNode);
        if (page) figma.currentPage = page;
        figma.currentPage.selection = [targetNode as SceneNode];
        figma.viewport.scrollAndZoomIntoView([targetNode as SceneNode]);
      } else {
        figma.notify("먼저 Import를 실행해주세요.", { error: true });
      }
      break;
    }
  }
  } catch (e) {
    console.error("[Comment Bridge] MSG ERROR:", e);
    figma.notify("Error: " + String(e), { error: true });
  }
};

function sendToUI(msg: UIMessage) {
  figma.ui.postMessage(msg);
}

// ══════════════════════════════════════════════════════════════════════
//  IMPORT
// ══════════════════════════════════════════════════════════════════════

async function importComments(payload: ImportPayload): Promise<void> {
  await Promise.all([
    figma.loadFontAsync({ family: "Inter", style: "Regular" }),
    figma.loadFontAsync({ family: "Inter", style: "Semi Bold" }),
  ]);

  // 1. 페이지 이름 → PageNode 매핑
  const pageMap = new Map<string, PageNode>();
  for (const page of figma.root.children) {
    pageMap.set(page.name, page);
  }

  // 2. 코멘트를 pageName별로 그룹화
  const commentsByPage = new Map<string, ImportComment[]>();
  for (const comment of payload.comments) {
    const page = comment.pageName || "";
    const arr = commentsByPage.get(page) ?? [];
    arr.push(comment);
    commentsByPage.set(page, arr);
  }

  const results: CommentResult[] = [];
  let lastGroup: FrameNode | null = null;
  let lastPage: PageNode | null = null;
  const totalComments = payload.comments.length;
  let processedComments = 0;

  // 3. 각 페이지별로 처리
  for (const [pageName, comments] of commentsByPage) {
    const targetPage = pageMap.get(pageName) ?? figma.currentPage;
    // Only build frame index if comments have frameName AND lack absoluteX/Y
    const needsFrameIndex = comments.some(
      (c) => c.frameName && c.frameName.length > 0 && c.absoluteX === undefined && c.absoluteY === undefined
    );
    const frameIndex = needsFrameIndex ? buildFrameIndex(targetPage) : new Map<string, SceneNode[]>();

    const placedNodes: { node: FrameNode; x: number; y: number }[] = [];
    const unplacedNodes: FrameNode[] = [];

    for (const comment of comments) {
      processedComments++;

      // Send progress every 5 comments + yield to let UI update
      if (processedComments % 5 === 1 || processedComments === totalComments) {
        sendToUI({
          type: "import-progress",
          current: processedComments,
          total: totalComments,
          pageName: pageName || "unknown",
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const fail = validateImportComment(comment);
      if (fail) {
        results.push({
          originalCommentId: comment.originalCommentId ?? "unknown",
          status: "failed",
          reason: fail,
        });
        continue;
      }

      const placement = resolveImportPosition(comment, frameIndex);
      const postIt = createPostIt(comment);

      postIt.setPluginData("originalCommentId", comment.originalCommentId);
      commentNodeMap.set(comment.originalCommentId, postIt.id);
      if (payload.exportSessionId) {
        postIt.setPluginData("exportSessionId", payload.exportSessionId);
      }
      if (payload.source?.branchName) {
        postIt.setPluginData("branchName", payload.source.branchName);
      }

      if (placement) {
        placedNodes.push({ node: postIt, x: placement.x, y: placement.y });
        results.push({
          originalCommentId: comment.originalCommentId,
          status: "placed",
        });
      } else {
        addMetaLabel(postIt, `frameName: ${comment.frameName}`);
        unplacedNodes.push(postIt);
        results.push({
          originalCommentId: comment.originalCommentId,
          status: "unplaced",
          reason: `Frame "${comment.frameName}" not found`,
        });
      }
    }

    applyStacking(placedNodes);
    for (const { node, x, y } of placedNodes) {
      node.x = x;
      node.y = y;
    }

    const allNodes = [
      ...placedNodes.map((p) => p.node),
      ...unplacedNodes,
    ];

    if (allNodes.length > 0) {
      const group = createGroupFrame();
      group.name = `${GROUP_FRAME_NAME} (${pageName || "unknown page"})`;

      if (unplacedNodes.length > 0) {
        const section = createUnplacedSection(unplacedNodes);
        group.appendChild(section);
      }

      for (const { node } of placedNodes) {
        group.appendChild(node);
      }

      targetPage.appendChild(group);
      lastGroup = group;
      lastPage = targetPage;
    }
  }

  // 마지막 페이지로 이동 + 선택
  if (lastGroup && lastPage) {
    figma.currentPage = lastPage;
    figma.currentPage.selection = [lastGroup];
    figma.viewport.scrollAndZoomIntoView([lastGroup]);
  }

  const placed = results.filter((r) => r.status === "placed").length;
  const unplaced = results.filter((r) => r.status === "unplaced").length;
  const failed = results.filter((r) => r.status === "failed").length;

  figma.notify(
    `Imported: ${placed} placed, ${unplaced} unplaced, ${failed} failed`
  );
  sendToUI({ type: "import-complete", placed, unplaced, failed, results });
}

function buildFrameIndex(page: PageNode): Map<string, SceneNode[]> {
  const frameIndex = new Map<string, SceneNode[]>();
  const allFrames = page.findAllWithCriteria({
    types: ["FRAME", "COMPONENT", "SECTION"],
  });
  for (const n of allFrames) {
    const arr = frameIndex.get(n.name) ?? [];
    arr.push(n);
    frameIndex.set(n.name, arr);
  }
  return frameIndex;
}

// ── Import validation ────────────────────────────────────────────────

function validateImportComment(c: ImportComment): string | null {
  if (!c.originalCommentId) return "missing originalCommentId";
  if (!c.author) return "missing author";
  if (!c.message) return "missing message";

  const hasRelative =
    c.relativeX !== undefined && c.relativeY !== undefined;
  const hasAbsolute =
    c.absoluteX !== undefined && c.absoluteY !== undefined;
  if (!hasRelative && !hasAbsolute)
    return "missing coordinates (need relativeX/Y or absoluteX/Y)";

  return null;
}

// ── Import position resolution ───────────────────────────────────────

function resolveImportPosition(
  comment: ImportComment,
  frameIndex: Map<string, SceneNode[]>
): { x: number; y: number } | null {
  const targetFrame = findFrameByName(comment.frameName, frameIndex);

  if (!targetFrame) {
    if (comment.absoluteX !== undefined && comment.absoluteY !== undefined) {
      return {
        x: comment.absoluteX + PLACEMENT_OFFSET_X,
        y: comment.absoluteY + PLACEMENT_OFFSET_Y,
      };
    }
    return null;
  }

  let x: number;
  let y: number;

  if (comment.relativeX !== undefined && comment.relativeY !== undefined) {
    const rx = clamp(comment.relativeX, 0, 1);
    const ry = clamp(comment.relativeY, 0, 1);
    x = targetFrame.absoluteTransform[0][2] + targetFrame.width * rx;
    y = targetFrame.absoluteTransform[1][2] + targetFrame.height * ry;
  } else {
    x = comment.absoluteX!;
    y = comment.absoluteY!;
  }

  x += PLACEMENT_OFFSET_X;
  y += PLACEMENT_OFFSET_Y;

  return { x, y };
}

function findFrameByName(name: string, frameIndex: Map<string, SceneNode[]>): SceneNode | null {
  const matches = frameIndex.get(name) ?? [];

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const sel = figma.currentPage.selection;
  if (sel.length > 0) {
    const selCenter = getCenter(sel[0]);
    let best = matches[0];
    let bestDist = Infinity;
    for (const m of matches) {
      const c = getCenter(m);
      const dist = Math.hypot(c.x - selCenter.x, c.y - selCenter.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    return best;
  }

  return matches[0];
}

// ── Import stacking ──────────────────────────────────────────────────

function applyStacking(
  nodes: { node: FrameNode; x: number; y: number }[]
): void {
  for (let i = 0; i < nodes.length; i++) {
    let clusterIndex = 0;
    for (let j = 0; j < i; j++) {
      if (
        Math.abs(nodes[i].x - nodes[j].x) <= CLUSTER_THRESHOLD &&
        Math.abs(nodes[i].y - nodes[j].y) <= CLUSTER_THRESHOLD
      ) {
        clusterIndex++;
      }
    }
    if (clusterIndex > 0) {
      nodes[i].y += clusterIndex * STACK_STEP_Y;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════════════════

function processExport(
  rawComments: FigmaAPIComment[],
  includeResolved: boolean,
  nodePositions: Record<string, NodePosition>
): ExportPayload {
  // 1. Filter resolved
  const filtered = includeResolved
    ? rawComments
    : rawComments.filter((c) => !c.resolved_at);

  console.log("[Comment Bridge] processExport: raw=" + rawComments.length + " filtered=" + filtered.length + " includeResolved=" + includeResolved);
  if (filtered.length > 0) {
    console.log("[Comment Bridge] sample comment keys:", JSON.stringify(Object.keys(filtered[0])));
    console.log("[Comment Bridge] sample parent_id:", JSON.stringify(filtered[0].parent_id), "resolved_at:", JSON.stringify(filtered[0].resolved_at));
  }

  // 2. Separate top-level comments and replies
  const topLevel = filtered.filter(
    (c) => !c.parent_id || c.parent_id === ""
  );
  console.log("[Comment Bridge] topLevel=" + topLevel.length);
  const repliesMap = new Map<string, FigmaAPIComment[]>();
  for (const c of filtered) {
    if (c.parent_id && c.parent_id !== "") {
      const arr = repliesMap.get(c.parent_id) ?? [];
      arr.push(c);
      repliesMap.set(c.parent_id, arr);
    }
  }

  // 3. Resolve each top-level comment
  const comments: ExportComment[] = [];
  for (const c of topLevel) {
    const pos = resolveExportPosition(c.client_meta, nodePositions);
    const thread = (repliesMap.get(c.id) ?? []).map((r) => ({
      author: r.user.handle,
      message: r.message,
      createdAt: r.created_at,
    }));

    comments.push({
      originalCommentId: c.id,
      author: c.user.handle,
      message: c.message,
      createdAt: c.created_at,
      thread,
      isResolved: c.resolved_at !== null && c.resolved_at !== undefined,
      ...pos,
    });
  }

  // 4. Build payload
  const docName = figma.root.name ?? "unknown";
  const sessionId = `${docName}_${new Date().toISOString().slice(0, 16)}`;

  return {
    exportSessionId: sessionId,
    source: {
      fileKey: figma.fileKey ?? "",
      branchName: "",
    },
    comments,
  };
}

// ── Export position resolution ────────────────────────────────────────

interface ExportPosition {
  pageName: string;
  frameName: string;
  nodeId?: string;
  relativeX?: number;
  relativeY?: number;
  absoluteX: number;
  absoluteY: number;
}

function resolveExportPosition(
  meta: FigmaClientMeta,
  nodePositions: Record<string, NodePosition>
): ExportPosition {
  if (meta.node_id) {
    // 1. Try Plugin API (works when plugin runs in the same file)
    const node = figma.getNodeById(meta.node_id);
    if (node && "absoluteTransform" in node) {
      const sceneNode = node as SceneNode;
      const commentX =
        sceneNode.absoluteTransform[0][2] + (meta.node_offset?.x ?? 0);
      const commentY =
        sceneNode.absoluteTransform[1][2] + (meta.node_offset?.y ?? 0);

      const topFrame = findTopLevelFrame(node);
      const page = findPage(node);

      if (topFrame && "absoluteTransform" in topFrame) {
        const tf = topFrame as SceneNode;
        const frameX = tf.absoluteTransform[0][2];
        const frameY = tf.absoluteTransform[1][2];

        return {
          pageName: page?.name ?? "",
          frameName: topFrame.name,
          nodeId: meta.node_id,
          relativeX:
            tf.width > 0 ? (commentX - frameX) / tf.width : 0,
          relativeY:
            tf.height > 0 ? (commentY - frameY) / tf.height : 0,
          absoluteX: Math.round(commentX),
          absoluteY: Math.round(commentY),
        };
      }

      return {
        pageName: page?.name ?? "",
        frameName: "",
        nodeId: meta.node_id,
        absoluteX: Math.round(commentX),
        absoluteY: Math.round(commentY),
      };
    }

    // 2. Fallback: use pre-resolved positions from REST API
    const apiPos = nodePositions[meta.node_id];
    if (apiPos) {
      const commentX = apiPos.absX + (meta.node_offset?.x ?? 0);
      const commentY = apiPos.absY + (meta.node_offset?.y ?? 0);
      return {
        pageName: apiPos.pageName,
        frameName: apiPos.frameName,
        nodeId: meta.node_id,
        // relativeX/Y 생략: REST API에서는 top-level frame 정보가 없어
        // 정확한 상대좌표 계산 불가. absoluteX/Y로 배치.
        relativeX: undefined,
        relativeY: undefined,
        absoluteX: Math.round(commentX),
        absoluteY: Math.round(commentY),
      };
    }
  }

  // 3. Final fallback: absolute coordinates from comment itself
  return {
    pageName: "",
    frameName: "",
    absoluteX: Math.round(meta.x ?? 0),
    absoluteY: Math.round(meta.y ?? 0),
  };
}

function findTopLevelFrame(node: BaseNode): BaseNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.parent?.type === "PAGE") {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function findPage(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === "PAGE") return current as PageNode;
    current = current.parent;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
//  Post-it card creation (shared)
// ══════════════════════════════════════════════════════════════════════

function createPostIt(comment: ImportComment): FrameNode {
  const BOLD = { family: "Inter", style: "Semi Bold" } as FontName;
  const REGULAR = { family: "Inter", style: "Regular" } as FontName;

  const frame = figma.createFrame();
  const label =
    comment.message.length > 30
      ? comment.message.substring(0, 30) + "…"
      : comment.message;
  frame.name = `💬 ${comment.author}: ${label}`;

  frame.resize(POST_IT_WIDTH, 10);
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "FIXED";
  frame.paddingLeft = 14;
  frame.paddingRight = 14;
  frame.paddingTop = 12;
  frame.paddingBottom = 12;
  frame.cornerRadius = 6;
  frame.fills = [{ type: "SOLID", color: COLORS.bg }];
  frame.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.8, b: 0.6 } }];
  frame.strokeWeight = 1;

  // Single text node for all content — minimizes node creation
  let fullText = comment.author + "\n" + comment.message;
  if (comment.thread && comment.thread.length > 0) {
    const replyText = comment.thread
      .map((r) => `↳ ${r.author}: ${r.message}`)
      .join("\n");
    fullText += "\n───\n" + replyText;
  }

  const textNode = figma.createText();
  textNode.fontName = REGULAR;
  textNode.characters = fullText;
  textNode.fontSize = 13;
  textNode.lineHeight = { value: 18, unit: "PIXELS" };
  textNode.fills = [{ type: "SOLID", color: COLORS.messageText }];

  // Only 1 setRange call: author bold
  textNode.setRangeFontName(0, comment.author.length, BOLD);

  frame.appendChild(textNode);
  textNode.layoutSizingHorizontal = "FILL";
  textNode.textAutoResize = "HEIGHT";

  return frame;
}

function addMetaLabel(frame: FrameNode, text: string): void {
  const meta = figma.createText();
  meta.fontName = { family: "Inter", style: "Regular" };
  meta.characters = text;
  meta.fontSize = 10;
  meta.fills = [{ type: "SOLID", color: COLORS.metaText }];
  frame.appendChild(meta);
  meta.layoutSizingHorizontal = "FILL";
}

// ── Group / unplaced frames ──────────────────────────────────────────

function createGroupFrame(): FrameNode {
  const group = figma.createFrame();
  group.name = GROUP_FRAME_NAME;
  group.fills = [];
  group.clipsContent = false;
  return group;
}

function createUnplacedSection(nodes: FrameNode[]): FrameNode {
  const section = figma.createFrame();
  section.name = UNPLACED_SECTION_NAME;
  section.layoutMode = "VERTICAL";
  section.primaryAxisSizingMode = "AUTO";
  section.counterAxisSizingMode = "AUTO";
  section.itemSpacing = 12;
  section.paddingLeft = 16;
  section.paddingRight = 16;
  section.paddingTop = 16;
  section.paddingBottom = 16;
  section.cornerRadius = 8;
  section.fills = [{ type: "SOLID", color: COLORS.groupBg }];

  const title = figma.createText();
  title.fontName = { family: "Inter", style: "Semi Bold" };
  title.characters = "Unplaced Comments (frame not found)";
  title.fontSize = 14;
  title.fills = [{ type: "SOLID", color: COLORS.authorText }];
  section.appendChild(title);

  for (const node of nodes) {
    section.appendChild(node);
  }

  return section;
}

// ── Utils ────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function getCenter(node: SceneNode): { x: number; y: number } {
  return {
    x: node.absoluteTransform[0][2] + node.width / 2,
    y: node.absoluteTransform[1][2] + node.height / 2,
  };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
