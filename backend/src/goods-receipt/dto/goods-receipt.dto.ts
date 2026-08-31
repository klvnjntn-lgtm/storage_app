export class ReceiveGoodsItemDto {
  purchaseOrderItemId: string;
  quantity: number;
}

export class ReceiveGoodsDto {
  locationId: string;
  notes?: string;
  items: ReceiveGoodsItemDto[];
}