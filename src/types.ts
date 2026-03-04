/** Thread reply within a comment */
export interface ThreadReply {
  author: string;
  message: string;
}

// ── Import types ─────────────────────────────────────────────────────

export interface ImportComment {
  originalCommentId: string;
  author: string;
  message: string;
  thread?: ThreadReply[];
  pageName?: string;
  frameName: string;
  relativeX?: number;
  relativeY?: number;
  absoluteX?: number;
  absoluteY?: number;
}

export interface ImportPayload {
  exportSessionId?: string;
  source?: {
    fileKey?: string;
    branchName?: string;
  };
  comments: ImportComment[];
}

export interface CommentResult {
  originalCommentId: string;
  status: "placed" | "unplaced" | "failed";
  reason?: string;
}

// ── Export types ─────────────────────────────────────────────────────

/** Figma REST API comment structure */
export interface FigmaAPIComment {
  id: string;
  parent_id: string;
  user: { handle: string; img_url: string };
  created_at: string;
  resolved_at: string | null;
  message: string;
  client_meta: FigmaClientMeta;
  order_id: string;
}

export interface FigmaClientMeta {
  node_id?: string;
  node_offset?: { x: number; y: number };
  x?: number;
  y?: number;
}

export interface ExportComment {
  originalCommentId: string;
  author: string;
  message: string;
  thread: ThreadReply[];
  isResolved: boolean;
  pageName: string;
  frameName: string;
  nodeId?: string;
  relativeX?: number;
  relativeY?: number;
  absoluteX: number;
  absoluteY: number;
}

export interface ExportPayload {
  exportSessionId: string;
  source: {
    fileKey: string;
    branchName: string;
  };
  comments: ExportComment[];
}

// ── Messages: UI → Plugin ────────────────────────────────────────────

export type PluginMessage =
  | { type: "import-comments"; payload: ImportPayload }
  | { type: "process-export"; rawComments: FigmaAPIComment[]; includeResolved: boolean }
  | { type: "save-token"; token: string }
  | { type: "request-filekey" }
  | { type: "save-export"; json: string }
  | { type: "load-export" };

// ── Messages: Plugin → UI ────────────────────────────────────────────

export type UIMessage =
  | { type: "init"; fileKey: string | undefined; savedToken: string }
  | {
      type: "import-complete";
      placed: number;
      unplaced: number;
      failed: number;
      results: CommentResult[];
    }
  | { type: "import-error"; error: string }
  | { type: "export-ready"; json: string; filename: string }
  | { type: "export-error"; error: string }
  | { type: "filekey-response"; fileKey: string | undefined }
  | { type: "export-saved" }
  | { type: "export-load-result"; json: string | null };
