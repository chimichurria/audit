#!/usr/bin/env node
import { doctorUi, formatChecks } from '../lib/doctor.mjs';

const r = doctorUi(process.argv[2] ?? '.');
console.log(formatChecks(r));
process.exitCode = r.ok ? 0 : 1;
