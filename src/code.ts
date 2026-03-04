import type { ImportComment, PluginMessage, UIMessage } from "./types";

// ── Constants ────────────────────────────────────────────────────────
const POST_IT_WIDTH = 280;
const STACK_OFFSET_Y = 60;
const STACK_OFFSET_X = 8;
const POSITION_SNAP = 50; // Round positions to this grid for overlap detection

const COLORS = {
  bg: { r: 1, g: 0.96, b: 0.75 },           // warm yellow
  bgResolved: { r: 0.92, g: 0.92, b: 0.92 }, // light gray for resolved
  shadow: { r: 0, g: 0, b: 0, a: 0.12 },
  authorText: { r: 0.25, g: 0.25, b: 0.25 },
  messageText: { r: 0.1, g: 0.1, b: 0.1 },
  replyAuthor: { r: 0.35, g: 0.35, b: 0.35 },
  replyText: { r: 0.2, g: 0.2, b: 0.2 },
  separator: { r: 0.82, g: 0.78, b: 0.6 },
  dateText: { r: 0.5, g: 0.5, b: 0.5 },
};

// ── Entry ────────────────────────────────────────────────────────────
figma.showUI(__html__, { width: 420, height: 520, themeColors: true });

figma.ui.onmessage = async (msg: PluginMessage) => {
  if (msg.type === "import-comments") {
    try {
      const count = await importComments(msg.comments);
      sendToUI({ type: "import-complete", count });
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
async function importComments(comments: ImportComment[]): Promise<number> {
  // Load required fonts
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  // Position overlap tracker: "snapX,snapY" -> stack count
  const positionMap = new Map<string, number>();

  const nodes: SceneNode[] = [];

  for (const comment of comments) {
    const postIt = createPostIt(comment, positionMap);
    nodes.push(postIt);
  }

  // Select all and zoom to view
  if (nodes.length > 0) {
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
  }

  figma.notify(`Imported ${nodes.length} comment(s) as annotations.`);
  return nodes.length;
}

// ── Post-it creation ─────────────────────────────────────────────────
function createPostIt(
  comment: ImportComment,
  positionMap: Map<string, number>
): FrameNode {
  const isResolved = comment.resolved === true;

  // Container frame with auto-layout
  const frame = figma.createFrame();
  const label = comment.message.length > 30
    ? comment.message.substring(0, 30) + "…"
    : comment.message;
  frame.name = `💬 ${comment.author}: ${label}`;

  frame.resize(POST_IT_WIDTH, 10); // height will auto-adjust
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "FIXED";
  frame.paddingLeft = 14;
  frame.paddingRight = 14;
  frame.paddingTop = 12;
  frame.paddingBottom = 12;
  frame.itemSpacing = 8;
  frame.cornerRadius = 6;

  // Background
  const bgColor = isResolved ? COLORS.bgResolved : COLORS.bg;
  frame.fills = [{ type: "SOLID", color: bgColor }];

  // Drop shadow
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

  // ── Author line ──
  const authorText = figma.createText();
  authorText.fontName = { family: "Inter", style: "Semi Bold" };
  authorText.characters = comment.author;
  authorText.fontSize = 12;
  authorText.fills = [{ type: "SOLID", color: COLORS.authorText }];
  frame.appendChild(authorText);
  authorText.layoutSizingHorizontal = "FILL";

  // ── Message body ──
  const messageText = figma.createText();
  messageText.fontName = { family: "Inter", style: "Regular" };
  messageText.characters = comment.message;
  messageText.fontSize = 13;
  messageText.lineHeight = { value: 18, unit: "PIXELS" };
  messageText.fills = [{ type: "SOLID", color: COLORS.messageText }];
  frame.appendChild(messageText);
  messageText.layoutSizingHorizontal = "FILL";
  messageText.textAutoResize = "HEIGHT";

  // ── Replies ──
  if (comment.replies && comment.replies.length > 0) {
    // Separator line
    const sep = figma.createFrame();
    sep.resize(POST_IT_WIDTH - 28, 1);
    sep.fills = [{ type: "SOLID", color: COLORS.separator }];
    frame.appendChild(sep);
    sep.layoutSizingHorizontal = "FILL";

    for (const reply of comment.replies) {
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

  // ── Date ──
  if (comment.createdAt) {
    const dateText = figma.createText();
    dateText.fontName = { family: "Inter", style: "Regular" };
    dateText.characters = comment.createdAt;
    dateText.fontSize = 10;
    dateText.fills = [{ type: "SOLID", color: COLORS.dateText }];
    frame.appendChild(dateText);
    dateText.layoutSizingHorizontal = "FILL";
  }

  // ── Resolved badge ──
  if (isResolved) {
    const badge = figma.createText();
    badge.fontName = { family: "Inter", style: "Semi Bold" };
    badge.characters = "✓ Resolved";
    badge.fontSize = 10;
    badge.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.7, b: 0.4 } }];
    frame.appendChild(badge);
    badge.layoutSizingHorizontal = "FILL";
  }

  // ── Position ──
  const pos = resolvePosition(comment, positionMap);
  frame.x = pos.x;
  frame.y = pos.y;

  // ── PluginData for future sync ──
  frame.setPluginData("commentId", comment.id);
  frame.setPluginData("commentData", JSON.stringify(comment));
  frame.setPluginData("source", "comment-bridge");

  return frame;
}

// ── Position resolution ──────────────────────────────────────────────
function resolvePosition(
  comment: ImportComment,
  positionMap: Map<string, number>
): { x: number; y: number } {
  const pos = comment.position;
  let x: number;
  let y: number;

  // 1. Try frameName + relativeX/Y
  if (pos.frameName && pos.relativeX !== undefined && pos.relativeY !== undefined) {
    const targetFrame = findFrameByName(pos.frameName);
    if (targetFrame) {
      // absoluteTransform is a 2×3 matrix: [[a,b,tx],[c,d,ty]]
      x = targetFrame.absoluteTransform[0][2] + pos.relativeX;
      y = targetFrame.absoluteTransform[1][2] + pos.relativeY;
    } else {
      // Frame not found → fallback to absolute
      x = pos.absoluteX;
      y = pos.absoluteY;
    }
  } else {
    // 2. Fallback: absoluteX/Y
    x = pos.absoluteX;
    y = pos.absoluteY;
  }

  // ── Overlap stacking ──
  const snapX = Math.round(x / POSITION_SNAP) * POSITION_SNAP;
  const snapY = Math.round(y / POSITION_SNAP) * POSITION_SNAP;
  const key = `${snapX},${snapY}`;
  const stackIndex = positionMap.get(key) ?? 0;
  positionMap.set(key, stackIndex + 1);

  x += stackIndex * STACK_OFFSET_X;
  y += stackIndex * STACK_OFFSET_Y;

  return { x, y };
}

function findFrameByName(name: string): FrameNode | null {
  const node = figma.currentPage.findOne(
    (n) => n.name === name && (n.type === "FRAME" || n.type === "COMPONENT" || n.type === "SECTION")
  );
  return node as FrameNode | null;
}
