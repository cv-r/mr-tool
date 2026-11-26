export type PlatformKind = 'gitlab' | 'github';

export interface MrUser {
  id?: number;
  username: string;
  name: string;
}

export interface OpenMr {
  iid: string;
  title: string;
  url: string;
}

export interface CreateOptions {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  assignee: MrUser | null;
  reviewers: MrUser[];
  removeSource: boolean;
  draft: boolean;
  squash: boolean;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'step';

export type Logger = (message: string, level?: LogLevel) => void;

export type CreateVia = 'cli' | 'api' | 'web';

export interface CreateResult {
  created: boolean;
  url: string;
  via: CreateVia;
  warning?: string;
}

/** CI / 流水线状态。 */
export type ChecksStatus = 'success' | 'failed' | 'running' | 'none' | 'unknown';

/** 能否合并：no 表示冲突或服务端明确不可合并。 */
export type Mergeable = 'yes' | 'no' | 'unknown';

export interface AssignedMr {
  id: string;
  projectPath: string;
  projectId?: number;
  iid: string;
  title: string;
  url: string;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  updatedAt: string;
  draft: boolean;
  mergeStatus: string;
  checks: ChecksStatus;
  mergeable: Mergeable;
  hasConflicts: boolean;
  /** 评审状态，GitHub 为 reviewDecision，GitLab 暂不提供。 */
  reviewDecision: string;
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface MergeResult {
  ok: boolean;
  message: string;
}

export interface MrContent {
  title: string;
  description: string;
}

export interface PlatformProvider {
  readonly kind: PlatformKind;
  readonly label: string;
  readonly cliName: string;
  readonly cliAvailable: boolean;
  searchMembers(query: string): Promise<MrUser[]>;
  currentUser(): Promise<MrUser | null>;
  findOpenMr(sourceBranch: string, targetBranch: string): Promise<OpenMr | null>;
  create(options: CreateOptions, log: Logger): Promise<CreateResult>;
  listAssignedMrs(): Promise<AssignedMr[]>;
  listReviewMrs(): Promise<AssignedMr[]>;
  listCreatedMrs(): Promise<AssignedMr[]>;
  getMrContent(mr: AssignedMr): Promise<MrContent>;
  editMr(mr: AssignedMr, content: MrContent): Promise<MergeResult>;
  mergeMr(mr: AssignedMr, method: MergeMethod): Promise<MergeResult>;
  approveMr(mr: AssignedMr): Promise<MergeResult>;
  markReady(mr: AssignedMr): Promise<MergeResult>;
  closeMr(mr: AssignedMr): Promise<MergeResult>;
  checkoutMr(mr: AssignedMr): Promise<MergeResult>;
}
