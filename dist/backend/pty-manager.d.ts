import WebSocket from 'ws';
import { IncomingMessage } from 'http';
export declare function handlePtyConnection(ws: WebSocket, req: IncomingMessage): void;
export declare function shutdownAll(): void;
