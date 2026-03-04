/** Thread reply within a comment */
export interface ThreadReply {
  author: string;
  message: string;
}

/** A single comment entry in the import JSON */
export interface ImportComment {
  originalCommentId: string;
  author: string;
  message: string;
  thread?: ThreadReply[];
  pageName?: string;
  frameName: string;
  /** Proportional X within frame (0–1) */
  relativeX?: number;
  /** Proportional Y within frame (0–1) */
  relativeY?: number;
  /** Absolute X fallback */
  absoluteX?: number;
  /** Absolute Y fallback */
  absoluteY?: number;
}

/** Top-level import JSON structure */
export interface ImportPayload {
  exportSessionId?: string;
  source?: {
    fileKey?: string;
    branchName?: string;
  };
  comments: ImportComment[];
}

/** Messages sent from UI to plugin code */
export interface PluginMessage {
  type: "import-comments";
  payload: ImportPayload;
}

/** Per-comment import result */
export interface CommentResult {
  originalCommentId: string;
  status: "placed" | "unplaced" | "failed";
  reason?: string;
}

/** Messages sent from plugin code to UI */
export interface UIMessage {
  type: "import-complete" | "import-error";
  placed?: number;
  unplaced?: number;
  failed?: number;
  results?: CommentResult[];
  error?: string;
}
