import swaggerJSDOC, { Options } from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Express } from "express";
import { config } from "dotenv";
import path from "path";
config();

const route = (routeFile: string) => path.join("./src/routes/", routeFile);
const options: Options = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: {
      title: "NodeJS Starter",
      version: "1.0.0",
      description: "NodeJS starter with Better-Auth.",
    },
    basePath: "localhost:3000/",
    host: "localhost",
    consumes: ["application/json"],
    produces: ["application/json"],
    tags: [{ name: "Authentication" }],
  },

  apis: [route("auth.routes.ts"), route("example.routes.ts")],
};

export const swaggerSpec = swaggerJSDOC(options);
export const swagger = (app: Express) => {
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api/docs-json", (_, res) => {
    res.send(swaggerSpec);
  });
};
