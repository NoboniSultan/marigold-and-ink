import { Router } from 'express';
import * as aboutController from './about.controller.ts';

export const aboutRouter = Router();

aboutRouter.get('/', aboutController.get);
