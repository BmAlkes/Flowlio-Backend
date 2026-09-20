import { Router } from "express";
import status from "http-status";
const routes = Router();

routes.use((req, res) => {
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    res.status(404).json({ success: false, code: "ENDPOINT_NOT_FOUND", message: "API endpoint not found" });
    return;
  }
  const isRequestSentFromAxios =
    req.headers["user-agent"] && req.headers.referer;

  if (isRequestSentFromAxios) {
    res.status(status.NOT_FOUND).json({ message: "Not Found" });
  } else {
    res.send(
      `<div style="display: flex; height: 95vh">
      <img style="margin: auto; border-radius: 2rem; height: 90vh;" src="/monkey.jpg" />
      </div>`
    );
  }
});

export default routes;
