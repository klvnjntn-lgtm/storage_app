import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateAvatarDto {
  // URL of a MediaAsset picked from the media library, or null to clear
  // the avatar back to the initials fallback. Restricted to that path
  // shape: the avatar is shown to everyone in the org, so an arbitrary URL
  // would let a user point it at an outside server and log who views it.
  @IsOptional()
  @IsString()
  @Matches(/^\/uploads\/media\/[A-Za-z0-9._-]+$/, {
    message: 'avatarUrl must be an image from the media library',
  })
  avatarUrl?: string | null;
}
