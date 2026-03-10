"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // src/code.ts
  var POST_IT_WIDTH = 280;
  var CLUSTER_THRESHOLD = 16;
  var STACK_STEP_Y = 12;
  var PLACEMENT_OFFSET_X = 24;
  var PLACEMENT_OFFSET_Y = -12;
  var GROUP_FRAME_NAME = "\u{1F5D2} Imported Comments (MVP)";
  var UNPLACED_SECTION_NAME = "\u{1F4CC} Unplaced";
  var TOKEN_STORAGE_KEY = "figmaToken";
  var EXPORT_DATA_KEY = "savedExport";
  var commentNodeMap = /* @__PURE__ */ new Map();
  var COLORS = {
    bg: { r: 1, g: 0.96, b: 0.75 },
    shadow: { r: 0, g: 0, b: 0, a: 0.12 },
    authorText: { r: 0.25, g: 0.25, b: 0.25 },
    messageText: { r: 0.1, g: 0.1, b: 0.1 },
    replyAuthor: { r: 0.35, g: 0.35, b: 0.35 },
    replyText: { r: 0.2, g: 0.2, b: 0.2 },
    separator: { r: 0.82, g: 0.78, b: 0.6 },
    metaText: { r: 0.5, g: 0.5, b: 0.5 },
    groupBg: { r: 0.97, g: 0.97, b: 0.97 }
  };
  figma.showUI(__html__, { width: 440, height: 560, themeColors: true });
  (async () => {
    var _a;
    try {
      const [savedToken, savedExport] = await Promise.all([
        figma.clientStorage.getAsync(TOKEN_STORAGE_KEY),
        figma.clientStorage.getAsync(EXPORT_DATA_KEY)
      ]);
      const savedFileKey = figma.root.getPluginData("fileKey") || void 0;
      const detectedFileKey = (_a = savedFileKey != null ? savedFileKey : figma.fileKey) != null ? _a : void 0;
      console.log("[Comment Bridge] init OK | fileKey:", detectedFileKey, "| hasToken:", !!savedToken, "| hasExport:", !!savedExport);
      sendToUI({
        type: "init",
        fileKey: detectedFileKey,
        savedToken: String(savedToken != null ? savedToken : ""),
        savedExport: savedExport != null ? savedExport : null
      });
    } catch (e) {
      console.error("[Comment Bridge] INIT ERROR:", e);
      figma.notify("Init error: " + String(e), { error: true });
    }
  })();
  figma.ui.onmessage = async (msg) => {
    var _a, _b;
    try {
      switch (msg.type) {
        case "import-comments":
          try {
            await importComments(msg.payload);
          } catch (e) {
            const errMsg = e instanceof Error ? e.message + " | stack: " + e.stack : String(e);
            console.error("[Comment Bridge] IMPORT ERROR:", errMsg);
            sendToUI({
              type: "import-error",
              error: errMsg
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
              filename
            });
          } catch (e) {
            sendToUI({
              type: "export-error",
              error: e instanceof Error ? e.message : String(e)
            });
          }
          break;
        case "save-token":
          await figma.clientStorage.setAsync(TOKEN_STORAGE_KEY, msg.token);
          break;
        case "request-filekey":
          sendToUI({
            type: "filekey-response",
            fileKey: ((_a = figma.fileKey) != null ? _a : figma.root.getPluginData("fileKey")) || void 0
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
          const saved = (_b = await figma.clientStorage.getAsync(EXPORT_DATA_KEY)) != null ? _b : null;
          sendToUI({ type: "export-load-result", json: saved, manual: !!msg.manual });
          break;
        }
        case "navigate-to-comment": {
          console.log("[Comment Bridge] navigate-to-comment:", msg.commentId, "| map size:", commentNodeMap.size);
          let targetNode = null;
          const cachedNodeId = commentNodeMap.get(msg.commentId);
          if (cachedNodeId) {
            targetNode = figma.getNodeById(cachedNodeId);
            console.log("[Comment Bridge] cache hit:", cachedNodeId, "| found:", !!targetNode);
          }
          if (!targetNode) {
            console.log("[Comment Bridge] cache miss, searching all pages\u2026");
            for (const page of figma.root.children) {
              const found = page.findOne(
                (n) => n.getPluginData("originalCommentId") === msg.commentId
              );
              if (found) {
                targetNode = found;
                commentNodeMap.set(msg.commentId, found.id);
                break;
              }
            }
          }
          if (targetNode) {
            const page = findPage(targetNode);
            if (page) figma.currentPage = page;
            figma.currentPage.selection = [targetNode];
            figma.viewport.scrollAndZoomIntoView([targetNode]);
          } else {
            figma.notify("\uD574\uB2F9 \uCF54\uBA58\uD2B8\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 Import\uB97C \uC2E4\uD589\uD574\uC8FC\uC138\uC694.", { error: true });
          }
          break;
        }
      }
    } catch (e) {
      console.error("[Comment Bridge] MSG ERROR:", e);
      figma.notify("Error: " + String(e), { error: true });
    }
  };
  function sendToUI(msg) {
    figma.ui.postMessage(msg);
  }
  async function importComments(payload) {
    var _a, _b, _c, _d;
    await Promise.all([
      figma.loadFontAsync({ family: "Inter", style: "Regular" }),
      figma.loadFontAsync({ family: "Inter", style: "Semi Bold" })
    ]);
    const pageMap = /* @__PURE__ */ new Map();
    for (const page of figma.root.children) {
      pageMap.set(page.name, page);
    }
    const commentsByPage = /* @__PURE__ */ new Map();
    for (const comment of payload.comments) {
      const page = comment.pageName || "";
      const arr = (_a = commentsByPage.get(page)) != null ? _a : [];
      arr.push(comment);
      commentsByPage.set(page, arr);
    }
    const results = [];
    let lastGroup = null;
    let lastPage = null;
    const pageEntries = [...commentsByPage.entries()];
    const totalPages = pageEntries.length;
    let pageIdx = 0;
    for (const [pageName, comments] of pageEntries) {
      pageIdx++;
      sendToUI({ type: "import-progress", current: pageIdx, total: totalPages, pageName: pageName || "unknown" });
      const targetPage = (_b = pageMap.get(pageName)) != null ? _b : figma.currentPage;
      const needsFrameIndex = comments.some((c) => c.frameName && c.frameName.length > 0);
      const frameIndex = needsFrameIndex ? buildFrameIndex(targetPage) : /* @__PURE__ */ new Map();
      const placedNodes = [];
      const unplacedNodes = [];
      for (const comment of comments) {
        const fail = validateImportComment(comment);
        if (fail) {
          results.push({
            originalCommentId: (_c = comment.originalCommentId) != null ? _c : "unknown",
            status: "failed",
            reason: fail
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
        if ((_d = payload.source) == null ? void 0 : _d.branchName) {
          postIt.setPluginData("branchName", payload.source.branchName);
        }
        if (placement) {
          placedNodes.push({ node: postIt, x: placement.x, y: placement.y });
          results.push({
            originalCommentId: comment.originalCommentId,
            status: "placed"
          });
        } else {
          addMetaLabel(postIt, `frameName: ${comment.frameName}`);
          unplacedNodes.push(postIt);
          results.push({
            originalCommentId: comment.originalCommentId,
            status: "unplaced",
            reason: `Frame "${comment.frameName}" not found`
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
        ...unplacedNodes
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
  function buildFrameIndex(page) {
    var _a;
    const frameIndex = /* @__PURE__ */ new Map();
    const allFrames = page.findAllWithCriteria({
      types: ["FRAME", "COMPONENT", "SECTION"]
    });
    for (const n of allFrames) {
      const arr = (_a = frameIndex.get(n.name)) != null ? _a : [];
      arr.push(n);
      frameIndex.set(n.name, arr);
    }
    return frameIndex;
  }
  function validateImportComment(c) {
    if (!c.originalCommentId) return "missing originalCommentId";
    if (!c.author) return "missing author";
    if (!c.message) return "missing message";
    const hasRelative = c.relativeX !== void 0 && c.relativeY !== void 0;
    const hasAbsolute = c.absoluteX !== void 0 && c.absoluteY !== void 0;
    if (!hasRelative && !hasAbsolute)
      return "missing coordinates (need relativeX/Y or absoluteX/Y)";
    return null;
  }
  function resolveImportPosition(comment, frameIndex) {
    const targetFrame = findFrameByName(comment.frameName, frameIndex);
    if (!targetFrame) {
      if (comment.absoluteX !== void 0 && comment.absoluteY !== void 0) {
        return {
          x: comment.absoluteX + PLACEMENT_OFFSET_X,
          y: comment.absoluteY + PLACEMENT_OFFSET_Y
        };
      }
      return null;
    }
    let x;
    let y;
    if (comment.relativeX !== void 0 && comment.relativeY !== void 0) {
      const rx = clamp(comment.relativeX, 0, 1);
      const ry = clamp(comment.relativeY, 0, 1);
      x = targetFrame.absoluteTransform[0][2] + targetFrame.width * rx;
      y = targetFrame.absoluteTransform[1][2] + targetFrame.height * ry;
    } else {
      x = comment.absoluteX;
      y = comment.absoluteY;
    }
    x += PLACEMENT_OFFSET_X;
    y += PLACEMENT_OFFSET_Y;
    return { x, y };
  }
  function findFrameByName(name, frameIndex) {
    var _a;
    const matches = (_a = frameIndex.get(name)) != null ? _a : [];
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
  function applyStacking(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      let clusterIndex = 0;
      for (let j = 0; j < i; j++) {
        if (Math.abs(nodes[i].x - nodes[j].x) <= CLUSTER_THRESHOLD && Math.abs(nodes[i].y - nodes[j].y) <= CLUSTER_THRESHOLD) {
          clusterIndex++;
        }
      }
      if (clusterIndex > 0) {
        nodes[i].y += clusterIndex * STACK_STEP_Y;
      }
    }
  }
  function processExport(rawComments, includeResolved, nodePositions) {
    var _a, _b, _c, _d;
    const filtered = includeResolved ? rawComments : rawComments.filter((c) => !c.resolved_at);
    console.log("[Comment Bridge] processExport: raw=" + rawComments.length + " filtered=" + filtered.length + " includeResolved=" + includeResolved);
    if (filtered.length > 0) {
      console.log("[Comment Bridge] sample comment keys:", JSON.stringify(Object.keys(filtered[0])));
      console.log("[Comment Bridge] sample parent_id:", JSON.stringify(filtered[0].parent_id), "resolved_at:", JSON.stringify(filtered[0].resolved_at));
    }
    const topLevel = filtered.filter(
      (c) => !c.parent_id || c.parent_id === ""
    );
    console.log("[Comment Bridge] topLevel=" + topLevel.length);
    const repliesMap = /* @__PURE__ */ new Map();
    for (const c of filtered) {
      if (c.parent_id && c.parent_id !== "") {
        const arr = (_a = repliesMap.get(c.parent_id)) != null ? _a : [];
        arr.push(c);
        repliesMap.set(c.parent_id, arr);
      }
    }
    const comments = [];
    for (const c of topLevel) {
      const pos = resolveExportPosition(c.client_meta, nodePositions);
      const thread = ((_b = repliesMap.get(c.id)) != null ? _b : []).map((r) => ({
        author: r.user.handle,
        message: r.message
      }));
      comments.push(__spreadValues({
        originalCommentId: c.id,
        author: c.user.handle,
        message: c.message,
        thread,
        isResolved: c.resolved_at !== null
      }, pos));
    }
    const docName = (_c = figma.root.name) != null ? _c : "unknown";
    const sessionId = `${docName}_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 16)}`;
    return {
      exportSessionId: sessionId,
      source: {
        fileKey: (_d = figma.fileKey) != null ? _d : "",
        branchName: ""
      },
      comments
    };
  }
  function resolveExportPosition(meta, nodePositions) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
    if (meta.node_id) {
      const node = figma.getNodeById(meta.node_id);
      if (node && "absoluteTransform" in node) {
        const sceneNode = node;
        const commentX = sceneNode.absoluteTransform[0][2] + ((_b = (_a = meta.node_offset) == null ? void 0 : _a.x) != null ? _b : 0);
        const commentY = sceneNode.absoluteTransform[1][2] + ((_d = (_c = meta.node_offset) == null ? void 0 : _c.y) != null ? _d : 0);
        const topFrame = findTopLevelFrame(node);
        const page = findPage(node);
        if (topFrame && "absoluteTransform" in topFrame) {
          const tf = topFrame;
          const frameX = tf.absoluteTransform[0][2];
          const frameY = tf.absoluteTransform[1][2];
          return {
            pageName: (_e = page == null ? void 0 : page.name) != null ? _e : "",
            frameName: topFrame.name,
            nodeId: meta.node_id,
            relativeX: tf.width > 0 ? (commentX - frameX) / tf.width : 0,
            relativeY: tf.height > 0 ? (commentY - frameY) / tf.height : 0,
            absoluteX: Math.round(commentX),
            absoluteY: Math.round(commentY)
          };
        }
        return {
          pageName: (_f = page == null ? void 0 : page.name) != null ? _f : "",
          frameName: "",
          nodeId: meta.node_id,
          absoluteX: Math.round(commentX),
          absoluteY: Math.round(commentY)
        };
      }
      const apiPos = nodePositions[meta.node_id];
      if (apiPos) {
        const commentX = apiPos.absX + ((_h = (_g = meta.node_offset) == null ? void 0 : _g.x) != null ? _h : 0);
        const commentY = apiPos.absY + ((_j = (_i = meta.node_offset) == null ? void 0 : _i.y) != null ? _j : 0);
        return {
          pageName: apiPos.pageName,
          frameName: apiPos.frameName,
          nodeId: meta.node_id,
          relativeX: apiPos.width > 0 ? ((_l = (_k = meta.node_offset) == null ? void 0 : _k.x) != null ? _l : 0) / apiPos.width : void 0,
          relativeY: apiPos.height > 0 ? ((_n = (_m = meta.node_offset) == null ? void 0 : _m.y) != null ? _n : 0) / apiPos.height : void 0,
          absoluteX: Math.round(commentX),
          absoluteY: Math.round(commentY)
        };
      }
    }
    return {
      pageName: "",
      frameName: "",
      absoluteX: Math.round((_o = meta.x) != null ? _o : 0),
      absoluteY: Math.round((_p = meta.y) != null ? _p : 0)
    };
  }
  function findTopLevelFrame(node) {
    var _a;
    let current = node;
    while (current) {
      if (((_a = current.parent) == null ? void 0 : _a.type) === "PAGE") {
        return current;
      }
      current = current.parent;
    }
    return null;
  }
  function findPage(node) {
    let current = node;
    while (current) {
      if (current.type === "PAGE") return current;
      current = current.parent;
    }
    return null;
  }
  function createPostIt(comment) {
    const BOLD = { family: "Inter", style: "Semi Bold" };
    const REGULAR = { family: "Inter", style: "Regular" };
    const frame = figma.createFrame();
    const label = comment.message.length > 30 ? comment.message.substring(0, 30) + "\u2026" : comment.message;
    frame.name = `\u{1F4AC} ${comment.author}: ${label}`;
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
    let fullText = comment.author + "\n" + comment.message;
    if (comment.thread && comment.thread.length > 0) {
      const replyText = comment.thread.map((r) => `\u21B3 ${r.author}: ${r.message}`).join("\n");
      fullText += "\n\u2500\u2500\u2500\n" + replyText;
    }
    const textNode = figma.createText();
    textNode.fontName = REGULAR;
    textNode.characters = fullText;
    textNode.fontSize = 13;
    textNode.lineHeight = { value: 18, unit: "PIXELS" };
    textNode.fills = [{ type: "SOLID", color: COLORS.messageText }];
    textNode.setRangeFontName(0, comment.author.length, BOLD);
    frame.appendChild(textNode);
    textNode.layoutSizingHorizontal = "FILL";
    textNode.textAutoResize = "HEIGHT";
    return frame;
  }
  function addMetaLabel(frame, text) {
    const meta = figma.createText();
    meta.fontName = { family: "Inter", style: "Regular" };
    meta.characters = text;
    meta.fontSize = 10;
    meta.fills = [{ type: "SOLID", color: COLORS.metaText }];
    frame.appendChild(meta);
    meta.layoutSizingHorizontal = "FILL";
  }
  function createGroupFrame() {
    const group = figma.createFrame();
    group.name = GROUP_FRAME_NAME;
    group.fills = [];
    group.clipsContent = false;
    return group;
  }
  function createUnplacedSection(nodes) {
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
  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }
  function getCenter(node) {
    return {
      x: node.absoluteTransform[0][2] + node.width / 2,
      y: node.absoluteTransform[1][2] + node.height / 2
    };
  }
  function todayStr() {
    return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  }
})();
