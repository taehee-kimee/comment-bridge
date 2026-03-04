import type {
  ImportComment,
  ImportPayload,
  CommentResult,
  PluginMessage,
  UIMessage,
} from "./types";

// ── Constants ────────────────────────────────────────────────────────
const POST_IT_WIDTH = 280;
const CLUSTER_THRESHOLD = 16; // ±px to consider "same cluster"
const STACK_STEP_Y = 12;     // vertical offset per stack index
const PLACEMENT_OFFSET_X = 24;
const PLACEMENT_OFFSET_Y = -12;
const GROUP_FRAME_NAME = "🗒 Imported Comments (MVP)";
const UNPLACED_SECTION_NAME = "📌 Unplaced";

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

// ── Entry ────────────────────────────────────────────────────────────
figma.showUI(__html__, { width: 420, height: 520, themeColors: true });

figma.ui.onmessage = async (msg: PluginMessage) => {
  if (msg.type === "import-comments") {
    try {
      await importComments(msg.payload);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      sendToUI({ type: "import-error", error });
    }
  }
};

function sendToUI(msg: UIMessage) {
  figma.ui.postMessage(msg);
}

// ── Import pipeline ──────────────────────────────────────────────────
async function importComments(payload: ImportPayload): Promise<void> {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  const results: CommentResult[] = [];
  const placedNodes: { node: FrameNode; x: number; y: number }[] = [];
  const unplacedNodes: FrameNode[] = [];

  for (const comment of payload.comments) {
    // ── Validate required fields ──
    const fail = validateComment(comment);
    if (fail) {
      results.push({
        originalCommentId: comment.originalCommentId ?? "unknown",
        status: "failed",
        reason: fail,
      });
      console.error(`[Comment Bridge] SKIP ${comment.originalCommentId}: ${fail}`);
      continue;
    }

    // ── Resolve position ──
    const placement = resolvePosition(comment);
    const postIt = createPostIt(comment);

    // Store pluginData
    postIt.setPluginData("originalCommentId", comment.originalCommentId);
    if (payload.exportSessionId) {
      postIt.setPluginData("exportSessionId", payload.exportSessionId);
    }
    if (payload.source?.branchName) {
      postIt.setPluginData("branchName", payload.source.branchName);
    }

    if (placement) {
      placedNodes.push({ node: postIt, x: placement.x, y: placement.y });
      results.push({ originalCommentId: comment.originalCommentId, status: "placed" });
    } else {
      // Add frameName meta for unplaced
      addMetaLabel(postIt, `frameName: ${comment.frameName}`);
      unplacedNodes.push(postIt);
      results.push({
        originalCommentId: comment.originalCommentId,
        status: "unplaced",
        reason: `Frame "${comment.frameName}" not found`,
      });
    }
  }

  // ── Apply stacking to placed nodes ──
  applyStacking(placedNodes);
  for (const { node, x, y } of placedNodes) {
    node.x = x;
    node.y = y;
  }

  // ── Build group frame ──
  const allNodes = [
    ...placedNodes.map((p) => p.node),
    ...unplacedNodes,
  ];

  if (allNodes.length > 0) {
    const group = createGroupFrame();

    // Add unplaced section if needed
    if (unplacedNodes.length > 0) {
      const section = createUnplacedSection(unplacedNodes);
      group.appendChild(section);
    }

    // Append placed nodes (they keep their absolute positions)
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

// ── Validation ───────────────────────────────────────────────────────
function validateComment(c: ImportComment): string | null {
  if (!c.originalCommentId) return "missing originalCommentId";
  if (!c.author) return "missing author";
  if (!c.message) return "missing message";
  if (!c.frameName) return "missing frameName";

  const hasRelative =
    c.relativeX !== undefined && c.relativeY !== undefined;
  const hasAbsolute =
    c.absoluteX !== undefined && c.absoluteY !== undefined;
  if (!hasRelative && !hasAbsolute) return "missing coordinates (need relativeX/Y or absoluteX/Y)";

  return null;
}

// ── Position resolution ──────────────────────────────────────────────
interface PlacedPosition {
  x: number;
  y: number;
}

function resolvePosition(comment: ImportComment): PlacedPosition | null {
  const targetFrame = findFrameByName(comment.frameName);

  if (!targetFrame) {
    // Cannot place — will go to unplaced section
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
    // Proportional: clamp 0–1 then multiply by frame dimensions
    const rx = clamp(comment.relativeX, 0, 1);
    const ry = clamp(comment.relativeY, 0, 1);
    x = targetFrame.absoluteTransform[0][2] + targetFrame.width * rx;
    y = targetFrame.absoluteTransform[1][2] + targetFrame.height * ry;
  } else {
    // Absolute fallback
    x = comment.absoluteX!;
    y = comment.absoluteY!;
  }

  // Offset so post-it doesn't cover the target UI element
  x += PLACEMENT_OFFSET_X;
  y += PLACEMENT_OFFSET_Y;

  return { x, y };
}

function findFrameByName(name: string): SceneNode | null {
  const matches = figma.currentPage.findAll(
    (n) =>
      n.name === name &&
      (n.type === "FRAME" || n.type === "COMPONENT" || n.type === "SECTION")
  );

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Multiple matches: prefer frame closest to current selection
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

function getCenter(node: SceneNode): { x: number; y: number } {
  return {
    x: node.absoluteTransform[0][2] + node.width / 2,
    y: node.absoluteTransform[1][2] + node.height / 2,
  };
}

// ── Stacking (cluster-based) ─────────────────────────────────────────
function applyStacking(
  nodes: { node: FrameNode; x: number; y: number }[]
): void {
  // For each node, check how many previous nodes are within ±CLUSTER_THRESHOLD
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

// ── Post-it card creation ────────────────────────────────────────────
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

  // ── Header: Author ──
  const authorText = figma.createText();
  authorText.fontName = { family: "Inter", style: "Semi Bold" };
  authorText.characters = comment.author;
  authorText.fontSize = 12;
  authorText.fills = [{ type: "SOLID", color: COLORS.authorText }];
  frame.appendChild(authorText);
  authorText.layoutSizingHorizontal = "FILL";

  // ── Body: Message ──
  const messageText = figma.createText();
  messageText.fontName = { family: "Inter", style: "Regular" };
  messageText.characters = comment.message;
  messageText.fontSize = 13;
  messageText.lineHeight = { value: 18, unit: "PIXELS" };
  messageText.fills = [{ type: "SOLID", color: COLORS.messageText }];
  frame.appendChild(messageText);
  messageText.layoutSizingHorizontal = "FILL";
  messageText.textAutoResize = "HEIGHT";

  // ── Thread ──
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

// ── Meta label for unplaced cards ────────────────────────────────────
function addMetaLabel(frame: FrameNode, text: string): void {
  const meta = figma.createText();
  meta.fontName = { family: "Inter", style: "Regular" };
  meta.characters = text;
  meta.fontSize = 10;
  meta.fills = [{ type: "SOLID", color: COLORS.metaText }];
  frame.appendChild(meta);
  meta.layoutSizingHorizontal = "FILL";
}

// ── Group frame ──────────────────────────────────────────────────────
function createGroupFrame(): FrameNode {
  const group = figma.createFrame();
  group.name = GROUP_FRAME_NAME;
  group.fills = [];
  // Use auto-layout so children are manageable, but placed nodes need absolute positioning
  // We'll use a non-auto-layout frame so placed nodes keep their x/y
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

  // Title
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
