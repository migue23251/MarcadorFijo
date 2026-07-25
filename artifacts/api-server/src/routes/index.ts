import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import configRouter from "./config";
import matchesRouter from "./matches";
import betsRouter from "./bets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(configRouter);
router.use(matchesRouter);
router.use(betsRouter);

export default router;
