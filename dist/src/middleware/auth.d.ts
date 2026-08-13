import { FastifyRequest, FastifyReply } from 'fastify';
export declare function seedLoadgenKey(): Promise<void>;
export declare function verifyApiKey(key: string): Promise<boolean>;
export declare function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void>;
