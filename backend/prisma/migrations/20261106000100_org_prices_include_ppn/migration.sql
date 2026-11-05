-- Whether the business's selling prices already include PPN. Only printed on
-- the Laporan Pajak for the tax administrator; nothing calculates from it.
-- NULL = not answered yet.
ALTER TABLE "Organization" ADD COLUMN "pricesIncludePpn" BOOLEAN;
