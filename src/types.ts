export interface CommentReply {
  id: string;
  message: string;
  author: string;
  createdAt?: string;
}

export interface CommentPosition {
  /** Target frame name for relative positioning */
  frameName?: string;
  /** Absolute X position (fallback) */
  absoluteX: number;
  /** Absolute Y position (fallback) */
  absoluteY: number;
  /** X position relative to the frame */
  relativeX?: number;
  /** Y position relative to the frame */
  relativeY?: number;
}

export interface ImportComment {
  id: string;
  message: string;
  author: string;
  createdAt?: string;
  resolved?: boolean;
  replies?: CommentReply[];
  position: CommentPosition;
}

/** Messages sent from UI to plugin code */
export interface PluginMessage {
  type: "import-comments";
  comments: ImportComment[];
}

/** Messages sent from plugin code to UI */
export interface UIMessage {
  type: "import-complete" | "import-error";
  count?: number;
  error?: string;
}
