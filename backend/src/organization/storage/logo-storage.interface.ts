export const LOGO_STORAGE = Symbol('LOGO_STORAGE');

export interface LogoStorage {

  save(orgId: string, file: Express.Multer.File): Promise<string>;
}