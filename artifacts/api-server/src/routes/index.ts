import { Router, type IRouter } from "express";
import usersRouter from "./users";
import matchesRouter from "./matches";
import betsRouter from "./bets";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(usersRouter);
router.use(matchesRouter);
router.use(betsRouter);
router.use(adminRouter);

export default router;
