// STEP 2: demo login. Pick a person, get a signed token.
// DEMO ONLY: there are no passwords. A real system would use OTP or government SSO here.
import { Router } from 'express';
import { z } from 'zod';
import { signToken } from '../auth';
import { ah, HttpError } from '../errors';
import { prisma } from '../infra';

export const authRoutes = Router();

authRoutes.get(
  '/users',
  ah(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, role: true, districtId: true, centreId: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  }),
);

authRoutes.post(
  '/login',
  ah(async (req, res) => {
    // Only userId is read. Anything else in the body (like "role") is ignored.
    const { userId } = z.object({ userId: z.string().min(1).max(50) }).parse(req.body);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, districtId: true, centreId: true },
    });
    if (!user) throw new HttpError(401, 'Unknown user');
    res.json({ token: signToken(user), user });
  }),
);
