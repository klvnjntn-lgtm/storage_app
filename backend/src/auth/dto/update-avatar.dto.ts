import { IsOptional, IsString } from 'class-validator';

export class UpdateAvatarDto {
  // URL of a MediaAsset picked from the media library, or null to clear
  // the avatar back to the initials fallback.
  @IsOptional()
  @IsString()
  avatarUrl?: string | null;
}
