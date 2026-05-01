export interface ChatMessage {
    role: 'user' | 'assistant' | 'thinking' | 'tool' | 'system';
    content: string;
    ts?: string;
    _partial?: boolean;
    meta?: {
        toolName?: string;
        toolCallId?: string;
        args?: string;
        result?: string;
        isError?: boolean;
        customType?: string;
    };
}
export interface SlotState {
    key: string;
    title: string;
    messages?: ChatMessage[];
    sessionFile: string | null;
    modelProvider: string | null;
    modelId: string | null;
    cwd: string | null;
    tags?: string[];
}
export interface SessionTreeEntry {
    id: string | null;
    parentId: string | null;
    type: string;
    timestamp?: string;
    role?: string;
    text?: string;
    fullText?: string;
    tools?: string[];
}
/** Duck-typed interface for PiProcess slots (avoids circular deps) */
interface SlotProcess {
    _title?: string;
    _tags?: string[];
    messages: ChatMessage[];
    sessionFile?: string | null;
    modelProvider?: string | null;
    modelId?: string | null;
    cwd?: string | null;
}
type ContentPart = {
    type: string;
    text?: string;
    thinking?: string;
};
export declare function parseSessionMessages(sessionPath: string, limit?: number): ChatMessage[];
export declare function extractText(content: string | ContentPart[] | null | undefined, separator?: string): string;
export declare function stripInjectedBlocks(text: string): string;
export declare function findSessionFile(key: string): string | null;
export declare function parseSessionTree(sessionPath: string): {
    entries: SessionTreeEntry[];
    leafId: string | null;
};
export declare function saveSlotState(slots: Map<string, SlotProcess>): void;
/** Synchronous save for shutdown — blocks but ensures data is written */
export declare function saveSlotStateSync(slots: Map<string, SlotProcess>): void;
export declare function loadSlotState(): SlotState[];
export {};
