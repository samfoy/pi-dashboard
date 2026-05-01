interface VaultDirs {
    daily: string;
    tasks: string;
    meetings: string;
    people: string;
    recipes: string;
}
interface VaultConfig {
    path: string;
    dirs: VaultDirs;
}
interface DashConfig {
    vault: VaultConfig;
    [key: string]: unknown;
}
interface MemoryStats {
    facts: number;
    lessons: number;
    events: number;
}
interface Lesson {
    id: string;
    rule: string;
    category: string;
    negative: number;
    created_at: string;
}
interface Fact {
    key: string;
    value: string;
    confidence: number;
    source: string;
    updated_at: string;
}
interface SessionSummary {
    key: string;
    title: string;
    project: string;
    created: string;
    modified: string;
    size: number;
}
interface Skill {
    name: string;
    description: string;
}
interface Extension {
    name: string;
    file: string;
    description: string;
}
interface CrontabEntry {
    schedule: string;
    command: string;
    raw: string;
}
interface VaultStats {
    path: string;
    dailyNotes: number;
    taskNotes: number;
    meetingNotes: number;
    persons: number;
    recipes: number;
    recentDaily: string;
}
interface DailyNoteSummary {
    date: string;
    size: number;
}
export declare function getDashConfig(): DashConfig;
export declare function saveDashConfig(config: Partial<DashConfig> & {
    vault?: Partial<VaultConfig> & {
        dirs?: Partial<VaultDirs>;
    };
}): DashConfig;
export declare function getLessons(limit?: number): Lesson[];
export declare function getFacts(): Fact[];
export declare function getMemoryStats(): MemoryStats;
export declare function getRecentSessions(limit?: number): SessionSummary[];
export declare function getSkills(): Skill[];
export declare function getExtensions(): Extension[];
export declare function getCrontab(): CrontabEntry[];
export declare function getVaultStats(): VaultStats;
export declare function getDailyNote(date: string): string | null;
export declare function getRecentDailyNotes(limit?: number): DailyNoteSummary[];
export {};
