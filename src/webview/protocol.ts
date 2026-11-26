import type { DiffInfo } from '../git';
import type { MrContext, ProgressStatus } from '../mrService';
import type { CreateResult, MrUser, OpenMr } from '../platforms/types';

/** 按仓库记住的上次表单选择。 */
export interface SavedForm {
  target?: string;
  assignee?: MrUser | null;
  reviewers?: MrUser[];
  removeSource?: boolean;
  draft?: boolean;
  squash?: boolean;
}

export interface ContextPayload {
  context: MrContext;
  existingMr: OpenMr | null;
  diff: DiffInfo | null;
  preferences: SavedForm | null;
}

export interface CreateRequest {
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

export type HostMessage =
  | { type: 'loading' }
  | { type: 'context'; payload: ContextPayload }
  | {
      type: 'inspect';
      source: string;
      target: string;
      existing: OpenMr | null;
      diff: DiffInfo | null;
      lastCommitSubject: string;
      lastCommitBody: string;
    }
  | { type: 'members'; requestId: number; query: string; members: MrUser[] }
  | { type: 'progress'; key: string; status: ProgressStatus; detail?: string }
  | { type: 'log'; message: string; level: string }
  | { type: 'result'; result: CreateResult }
  | { type: 'createError'; message: string }
  | { type: 'loadError'; message: string }
  | { type: 'branchSwitched'; branch: string }
  | { type: 'branchSwitchFailed'; message: string };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'searchMembers'; requestId: number; query: string }
  | { type: 'inspect'; source: string; target: string }
  | { type: 'create'; options: unknown }
  | { type: 'openExternal'; url: string }
  | { type: 'copy'; text: string }
  | { type: 'switchBranch'; branch: string }
  | { type: 'openSettings' };
