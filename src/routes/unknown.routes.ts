import { Router } from "express";
import status from "http-status";
const routes = Router();

routes.use((req, res) => {
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
