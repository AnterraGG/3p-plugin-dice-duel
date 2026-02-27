/**
 * useCountdown — Returns a formatted countdown string for a unix timestamp.
 * Updates every second. Returns null when expired.
 */

import { useEffect, useState } from "react";

export function useCountdown(
	expiresAtUnix: number | null | undefined,
): string | null {
	const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

	useEffect(() => {
		if (expiresAtUnix == null) return;
		const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
		return () => clearInterval(id);
	}, [expiresAtUnix]);

	if (expiresAtUnix == null || expiresAtUnix <= 0) return null;

	const remaining = expiresAtUnix - now;
	if (remaining <= 0) return null;

	const minutes = Math.floor(remaining / 60);
	const seconds = remaining % 60;

	if (minutes >= 60) {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours}h ${mins}m`;
	}

	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
