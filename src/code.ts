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
  const savedToken =
    (await figma.clientStorage.getAsync(TOKEN_STORAGE_KEY)) ?? "";
  sendToUI({
    type: "init",
    fileKey: figma.fileKey,
    savedToken: String(savedToken),
  });
})();

figma.ui.onmessage = async (msg: PluginMessage) => {
  switch (msg.type) {
    case "import-comments":
      try {
        await importComments(msg.payload);
      } catch (e: unknown) {
        sendToUI({
          type: "import-error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
      break;

    case "process-export":
      try {
        const result = processExport(msg.rawComments, msg.includeResolved);
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
  }
};

function sendToUI(msg: UIMessage) {
  figma.ui.postMessage(msg);
}

// ══════════════════════════════════════════════════════════════════════
//  IMPORT
// ══════════════════════════════════════════════════════════════════════

async function importComments(payload: ImportPayload): Promise<void> {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  const results: CommentResult[] = [];
  const placedNodes: { node: FrameNode; x: number; y: number }[] = [];
  const unplacedNodes: FrameNode[] = [];

  for (const comment of payload.comments) {
    const fail = validateImportComment(comment);
    if (fail) {
      results.push({
        originalCommentId: comment.originalCommentId ?? "unknown",
        status: "failed",
        reason: fail,
      });
      console.error(
        `[Comment Bridge] SKIP ${comment.originalCommentId}: ${fail}`
      );
      continue;
    }

    const placement = resolveImportPosition(comment);
    const postIt = createPostIt(comment);

    postIt.setPluginData("originalCommentId", comment.originalCommentId);
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

    if (unplacedNodes.length > 0) {
      const section = createUnplacedSection(unplacedNodes);
      group.appendChild(section);
    }

    for (const { node } of placedNodes) {
      group.appendChild(node);
    }

    figma.currentPage.appendChild(group);
    figma.currentPage.selection = [group];
    figma.viewport.scrollAndZoomIntoView([group]);
  }

  const placed = results.filter((r) => r.status === "placed").length;
  const unplaced = results.filter((r) => r.status === "unplaced").length;
  const failed = results.filter((r) => r.status === "failed").length;

  figma.notify(
    `Imported: ${placed} placed, ${unplaced} unplaced, ${failed} failed`
  );
  sendToUI({ type: "import-complete", placed, unplaced, failed, results });
}

// ── Import validation ────────────────────────────────────────────────

function validateImportComment(c: ImportComment): string | null {
  if (!c.originalCommentId) return "missing originalCommentId";
  if (!c.author) return "missing author";
  if (!c.message) return "missing message";
  if (!c.frameName) return "missing frameName";

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
  comment: ImportComment
): { x: number; y: number } | null {
  const targetFrame = findFrameByName(comment.frameName);

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

function findFrameByName(name: string): SceneNode | null {
  const matches = figma.currentPage.findAll(
    (n) =>
      n.name === name &&
      (n.type === "FRAME" ||
        n.type === "COMPONENT" ||
        n.type === "SECTION")
  );

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
  includeResolved: boolean
): ExportPayload {
  // 1. Filter resolved
  const filtered = includeResolved
    ? rawComments
    : rawComments.filter((c) => !c.resolved_at);

  // 2. Separate top-level comments and replies
  const topLevel = filtered.filter(
    (c) => !c.parent_id || c.parent_id === ""
  );
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
    const pos = resolveExportPosition(c.client_meta);
    const thread = (repliesMap.get(c.id) ?? []).map((r) => ({
      author: r.user.handle,
      message: r.message,
    }));

    comments.push({
      originalCommentId: c.id,
      author: c.user.handle,
      message: c.message,
      thread,
      isResolved: c.resolved_at !== null,
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

function resolveExportPosition(meta: FigmaClientMeta): ExportPosition {
  if (meta.node_id) {
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

      // Node found, but no parent frame — use pageName + absolute
      return {
        pageName: page?.name ?? "",
        frameName: "",
        nodeId: meta.node_id,
        absoluteX: Math.round(commentX),
        absoluteY: Math.round(commentY),
      };
    }
  }

  // No node_id or node not found — absolute only
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
  frame.itemSpacing = 8;
  frame.cornerRadius = 6;
  frame.fills = [{ type: "SOLID", color: COLORS.bg }];
  frame.effects = [
    {
      type: "DROP_SHADOW",
      color: COLORS.shadow,
      offset: { x: 0, y: 2 },
      radius: 8,
      spread: 0,
      visible: true,
      blendMode: "NORMAL",
    },
  ];

  // Header: Author
  const authorText = figma.createText();
  authorText.fontName = { family: "Inter", style: "Semi Bold" };
  authorText.characters = comment.author;
  authorText.fontSize = 12;
  authorText.fills = [{ type: "SOLID", color: COLORS.authorText }];
  frame.appendChild(authorText);
  authorText.layoutSizingHorizontal = "FILL";

  // Body: Message
  const messageText = figma.createText();
  messageText.fontName = { family: "Inter", style: "Regular" };
  messageText.characters = comment.message;
  messageText.fontSize = 13;
  messageText.lineHeight = { value: 18, unit: "PIXELS" };
  messageText.fills = [{ type: "SOLID", color: COLORS.messageText }];
  frame.appendChild(messageText);
  messageText.layoutSizingHorizontal = "FILL";
  messageText.textAutoResize = "HEIGHT";

  // Thread
  if (comment.thread && comment.thread.length > 0) {
    const sep = figma.createFrame();
    sep.resize(POST_IT_WIDTH - 28, 1);
    sep.fills = [{ type: "SOLID", color: COLORS.separator }];
    frame.appendChild(sep);
    sep.layoutSizingHorizontal = "FILL";

    for (const reply of comment.thread) {
      const replyContainer = figma.createFrame();
      replyContainer.layoutMode = "VERTICAL";
      replyContainer.primaryAxisSizingMode = "AUTO";
      replyContainer.counterAxisSizingMode = "AUTO";
      replyContainer.itemSpacing = 2;
      replyContainer.paddingLeft = 10;
      replyContainer.fills = [];
      frame.appendChild(replyContainer);
      replyContainer.layoutSizingHorizontal = "FILL";

      const replyAuthor = figma.createText();
      replyAuthor.fontName = { family: "Inter", style: "Semi Bold" };
      replyAuthor.characters = `↳ ${reply.author}`;
      replyAuthor.fontSize = 11;
      replyAuthor.fills = [{ type: "SOLID", color: COLORS.replyAuthor }];
      replyContainer.appendChild(replyAuthor);
      replyAuthor.layoutSizingHorizontal = "FILL";

      const replyMsg = figma.createText();
      replyMsg.fontName = { family: "Inter", style: "Regular" };
      replyMsg.characters = reply.message;
      replyMsg.fontSize = 12;
      replyMsg.lineHeight = { value: 16, unit: "PIXELS" };
      replyMsg.fills = [{ type: "SOLID", color: COLORS.replyText }];
      replyContainer.appendChild(replyMsg);
      replyMsg.layoutSizingHorizontal = "FILL";
      replyMsg.textAutoResize = "HEIGHT";
    }
  }

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
