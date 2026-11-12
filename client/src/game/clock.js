// The game's clock in ms: the wall time when the page loaded, then performance.now(), which only runs
// forward. Changing the device's clock mid-run can't move it, so it can't buy landing odds or time.
export const clock = () => performance.timeOrigin + performance.now();
