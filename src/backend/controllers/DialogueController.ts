import { inject, injectable } from 'inversify';
import type Controller from '@/backend/controllers/Controller';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import TYPES from '@/backend/ioc/types';
import type DialogueService from '@/backend/services/DialogueService';

/**
 * 场景对话 IPC 控制器：注册 dialogue/* 路径。
 */
@injectable()
export default class DialogueController implements Controller {
    @inject(TYPES.DialogueService)
    private dialogueService!: DialogueService;

    registerRoutes(): void {
        registerRoute('dialogue/availability', () => this.dialogueService.availability());
        registerRoute('dialogue/create', (p) => this.dialogueService.create(p));
        registerRoute('dialogue/transcribe', (p) => this.dialogueService.transcribe(p));
        registerRoute('dialogue/append-turn', (p) => this.dialogueService.appendTurn(p));
        registerRoute('dialogue/finish', (p) => this.dialogueService.finish(p));
        registerRoute('dialogue/list', (p) => this.dialogueService.list(p));
        registerRoute('dialogue/detail', (p) => this.dialogueService.detail(p.sessionId));
    }
}
