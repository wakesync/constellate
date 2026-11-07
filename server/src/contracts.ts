import { z } from 'zod';
export const birthSchema = z.object({
 date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
 timeZone:z.string().min(1).max(100),
 latitude:z.number().min(-90).max(90).nullable(),
 longitude:z.number().min(-180).max(180).nullable(),
 consent:z.literal(true),
}).strict();
export type BirthInput=z.infer<typeof birthSchema>;
export interface Chart {version:string;calculatedAt:string;timeKnown:boolean;placements:{body:string;longitude:number;sign:string;degree:number}[];limitations:string[]}
export interface Profile {birth:BirthInput;chart:Chart;updatedAt:string}
export interface InferenceResult {text:string;provider:'tinfoil';model:string;verification:'sdk-attested';generatedAt:string}
export interface Reading extends InferenceResult {id:string;chart:Chart;createdAt:string}
