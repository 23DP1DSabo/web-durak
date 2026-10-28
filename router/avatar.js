import express from "express";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { GameError } from "../lib/multiplayer.js";

export function createAvatarRouter(prisma, { getAuthenticatedUser, publicUser }) {
  const router = express.Router();
  router.use("/auth/avatar", async (req, res, next) => {
    const user = await getAuthenticatedUser(req, res);
    if (!user) return;
    req.avatarUser = user;
    next();
  });
  router.put("/auth/avatar", express.raw({
    type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb",
  }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw new GameError("Izvēlies JPG, PNG vai WebP attēlu līdz 5 MB.", 400);
    }
    let image;
    try {
      const input = sharp(req.body, { limitInputPixels: 20000000, failOn: "warning" });
      const metadata = await input.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages || 1) > 1) {
        throw new Error("Unsupported image");
      }
      image = await input.rotate().resize(512, 512, { fit: "cover", position: "centre" })
        .webp({ quality: 85 }).toBuffer();
    } catch {
      throw new GameError("Neizdevās nolasīt attēlu. Izvēlies neanimētu JPG, PNG vai WebP attēlu līdz 20 megapikseļiem.", 400);
    }
    const userId = req.avatarUser.id;
    const digest = createHash("sha256").update(image).digest("hex");
    const user = await prisma.$transaction(async (db) => {
      await db.userAvatar.upsert({ where: { userId }, create: { userId, image, digest }, update: { image, digest } });
      return db.user.update({ where: { id: userId }, data: { avatar: `/api/avatars/${userId}?v=${digest}` } });
    });
    res.json({ user: publicUser(user) });
  });
  router.delete("/auth/avatar", async (req, res) => {
    const userId = req.avatarUser.id;
    const user = await prisma.$transaction(async (db) => {
      await db.userAvatar.deleteMany({ where: { userId } });
      return db.user.update({ where: { id: userId }, data: { avatar: null } });
    });
    res.json({ user: publicUser(user) });
  });
  router.get("/avatars/:userId", async (req, res) => {
    const id = req.params.userId;
    if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) return res.sendStatus(404);
    const avatar = await prisma.userAvatar.findUnique({ where: { userId: BigInt(id) } });
    if (!avatar || (req.query.v && req.query.v !== avatar.digest)) return res.sendStatus(404);
    res.set({ "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300" });
    res.send(Buffer.from(avatar.image));
  });
  return router;
}
