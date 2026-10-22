export function allowedOrigins(configuredOrigins, fallbackOrigin) {
  const origins = typeof configuredOrigins === "string"
    ? configuredOrigins.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];

  return new Set(origins.length > 0 ? origins : [fallbackOrigin]);
}

export function isAllowedOrigin(origin, origins) {
  return !origin || origins.has(origin);
}
