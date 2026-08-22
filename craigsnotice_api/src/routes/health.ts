import { Hono } from "hono";
import { successResponse } from "@craigsnotice/types";

const router = new Hono();

router.get("/", (c) => c.json(successResponse({ status: "ok" })));

export default router;
