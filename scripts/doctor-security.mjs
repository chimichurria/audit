#!/usr/bin/env node
import { doctorSecurity, formatChecks } from '../lib/doctor.mjs';

const r = doctorSecurity(process.argv[2] ?? '.');
console.log(formatChecks(r));
process.exitCode = r.ok ? 0 : 1;
