import type { TeacherBoardState } from "../teacher/teacherBoardState";
export interface ClassroomConnection {
  start(): Promise<void>;
  stop(): Promise<void>;
  invoke<T = any>(method: string, ...args: any[]): Promise<T>;
  on(name: string, handler: (...args: any[]) => void): void;
  off(name: string, handler?: (...args: any[]) => void): void;
  recoveredBoard?(): TeacherBoardState;
  recoveredIndicators?(): {
    confidence: "none" | "red" | "amber" | "green";
    answered: boolean;
  };
  readonly isPeer?: boolean;
}
