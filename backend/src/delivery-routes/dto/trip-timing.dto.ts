// src/delivery-routes/dto/trip-timing.dto.ts
import { IsInt, IsNumber, Max, Min } from 'class-validator';

// How the business's trips compare with the road data (see trip-timing.ts).
export class UpdateTripTimingDto {
  // Road travel times × this. 1.3 = trips take 30% longer than the map says.
  @IsNumber()
  @Min(0.5)
  @Max(5)
  travelFactor!: number;

  // Minutes spent at each stop.
  @IsInt()
  @Min(0)
  @Max(120)
  stopMinutes!: number;
}
