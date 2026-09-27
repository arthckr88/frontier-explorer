async function main() {
  console.log("The Frontier booking crawl is limited to the OAK, SFO, LAS, and Southern California corridors. This New York bulk crawl does not run.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
