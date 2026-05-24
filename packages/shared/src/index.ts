export type HealthStatus = {
  service: "zmail-api";
  status: "ok";
};

export const healthy: HealthStatus = {
  service: "zmail-api",
  status: "ok",
};
