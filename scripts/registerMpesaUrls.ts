import 'dotenv/config';
import { getMpesaConfig, registerC2BUrls, resolveC2BCallbackUrls } from '../server/mpesa.ts';

async function main() {
  const args = process.argv.slice(2);
  const registerAll = args.includes('--all');
  const shortCodeArg = args.find((a) => !a.startsWith('--'));
  const cfg = getMpesaConfig();
  const urls = resolveC2BCallbackUrls();

  console.log('--- MajiTrack Safaricom M-Pesa C2B URL Registration ---');
  console.log(`Environment:       ${cfg.environment}`);
  console.log(`Validation URL:    ${urls.validationUrl}`);
  console.log(`Confirmation URL:  ${urls.confirmationUrl}`);
  console.log(
    `Target ShortCode:  ${registerAll ? cfg.supportedShortCodes.join(', ') : shortCodeArg || cfg.defaultShortCode}`
  );

  const output = await registerC2BUrls({
    shortCode: shortCodeArg,
    registerAllSupported: registerAll,
  });

  console.log('Registration Results:', JSON.stringify(output, null, 2));

  const anyFailed = output.results.some((r) => !r.ok);
  if (anyFailed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Failed to register M-Pesa C2B URLs:', err instanceof Error ? err.message : err);
  process.exit(1);
});
