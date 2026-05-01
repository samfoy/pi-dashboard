/**
 * Pi RPC Process Manager
 * Spawns and manages `pi --mode rpc` processes, one per chat slot.
 */
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { ChatMessage } from './session-store.js';
interface ImagePayload {
    type: string;
    mimeType?: string;
    media_type?: string;
    data?: string;
    source?: {
        data?: string;
        type?: string;
        mediaType?: string;
    };
}
interface PiProcessOptions {
    messages?: ChatMessage[];
    sessionFile?: string | null;
    agent?: string | null;
    cwd?: string | null;
    modelProvider?: string | null;
    modelId?: string | null;
    title?: string | null;
    key?: string;
    tags?: string[];
}
interface SlotInfo {
    key: string;
    title: string;
    messages: number;
    running: boolean;
    stopping: boolean;
    pending_approval: boolean;
    model: string | null;
    cwd: string | null;
    tags: string[];
    created_at: string;
    updated_at: string;
}
interface SlotDetail {
    messages: ChatMessage[];
    running: boolean;
    stopping: boolean;
    pending_approval: boolean;
    has_more: boolean;
    total: number;
    model: string | null;
    cwd: string | null;
    contextUsage: any | null;
    tokenStats: any | null;
}
export declare class PiProcess extends EventEmitter {
    slotKey: string;
    proc: ChildProcess | null;
    buffer: string;
    ready: boolean;
    running: boolean;
    messages: ChatMessage[];
    sessionFile: string | null;
    agent: string | null;
    cwd: string | null;
    modelProvider: string | null;
    modelId: string | null;
    _title: string | null;
    _tags: string[];
    _userRenamed: boolean;
    _startTime: number;
    _lastActivity: number;
    _pendingRequests: Map<string, {
        resolve: (value: any) => void;
        timer: ReturnType<typeof setTimeout>;
    }>;
    _stopping: boolean;
    _pendingApproval: boolean;
    _streamIdx: number;
    _stderrLines: string[];
    _startupTimer: ReturnType<typeof setTimeout> | null;
    _stoppingTimer?: ReturnType<typeof setTimeout> | null;
    _readyPromise?: Promise<void> | null;
    _contextUsage?: any;
    _tokenStats?: any;
    _wired?: boolean;
    constructor(slotKey: string, opts?: PiProcessOptions);
    start(): void;
    send(cmd: Record<string, any>): boolean;
    /** Send a command and wait for the response by id */
    request(cmd: Record<string, any>, timeoutMs?: number): Promise<any>;
    prompt(message: string, images?: ImagePayload[]): Promise<boolean | void>;
    abort(): boolean;
    getAvailableModels(): Promise<any[]>;
    getCommands(): Promise<any[]>;
    setModel(provider: string, modelId: string): Promise<any>;
    setThinkingLevel(level: string): Promise<any>;
    getState(): Promise<any>;
    /**
     * Gracefully shut down the pi process by closing stdin.
     * This triggers pi's session_shutdown lifecycle (memory consolidation, etc.)
     * and waits for the process to exit naturally.
     * Returns a promise that resolves when the process exits or the timeout fires.
     */
    gracefulShutdown(timeoutMs?: number): Promise<void>;
    kill(): void;
    private _rejectPendingRequests;
    /**
     * Check if the child process is still alive. If it's dead but we still
     * think we're running/stopping, reset state and emit agent_end so the
     * UI can recover.
     */
    checkHealth(): boolean;
    _handleEvent(event: any): void;
}
export declare class PiManager {
    slots: Map<string, PiProcess>;
    _slotCounter: number;
    _startTime: number;
    _onStateChange: (() => void) | null;
    _modelCache: any[] | null;
    _modelCacheTime: number;
    _healthInterval: ReturnType<typeof setInterval> | null;
    constructor();
    createSlot(name: string, agent: string | null, opts?: PiProcessOptions): {
        key: string;
        title: string;
        messages: number;
        running: boolean;
    };
    restoreSlot(key: string, title: string, messages: ChatMessage[], opts?: PiProcessOptions): void;
    ensureRunning(key: string): PiProcess | null;
    getSlot(key: string): PiProcess | undefined;
    deleteSlot(key: string): void;
    listSlots(): SlotInfo[];
    getSlotDetail(key: string, limit?: number): SlotDetail | null;
    /** Get available models (cached, refreshed via any running pi process) */
    getModels(): Promise<any[]>;
    status(): {
        version: string;
        uptime: number;
        sessions: number;
        messages: number;
        tool_calls: number;
        provider: string;
    };
    getCommands(): Promise<any[] | null>;
    _save(): void;
    _healthCheck(): void;
    shutdown(): void;
    /** Graceful shutdown — gives each pi process time to consolidate memory */
    gracefulShutdown(timeoutMs?: number): Promise<void>;
}
export {};
