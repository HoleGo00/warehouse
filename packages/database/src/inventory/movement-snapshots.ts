import type { Prisma } from '../generated/prisma/client.js';

export async function loadMovementSnapshots(
  transaction: Prisma.TransactionClient,
  variantIds: readonly string[],
  actorUserId?: string,
) {
  const actor = actorUserId
    ? await transaction.user.findUniqueOrThrow({
        where: { id: actorUserId },
        select: { name: true, feishuUserId: true },
      })
    : null;
  const variants = await transaction.productVariant.findMany({
    where: { id: { in: [...new Set(variantIds)] } },
    select: { id: true, product: { select: { officialName: true } } },
  });
  return new Map(
    variants.map((variant) => [
      variant.id,
      {
        productNameSnapshot: variant.product.officialName,
        actorNameSnapshot: actor?.name ?? null,
        actorFeishuUserId: actor?.feishuUserId ?? null,
      },
    ]),
  );
}
