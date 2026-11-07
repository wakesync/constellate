import {betterAuth,type BetterAuthOptions} from 'better-auth';
import {getMigrations} from 'better-auth/db/migration';
import type Database from 'better-sqlite3';
export async function createAuth(database:Database.Database,baseURL:string,secret:string){
 if(secret.length<32)throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
 const options:BetterAuthOptions={database,baseURL,secret,trustedOrigins:[baseURL],
 emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128},
 session:{expiresIn:60*60*24*7,updateAge:60*60*24},
 rateLimit:{enabled:true,storage:'database',window:60,max:60,customRules:{'/sign-in/email':{window:60,max:10},'/sign-up/email':{window:60,max:5}}},
 advanced:{ipAddress:{ipAddressHeaders:['x-constellate-client-ip']},useSecureCookies:baseURL.startsWith('https:'),defaultCookieAttributes:{httpOnly:true,sameSite:'lax'}},
 };
 const migration=await getMigrations(options);await migration.runMigrations();return betterAuth(options);
}
