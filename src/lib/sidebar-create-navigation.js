/**
 * Coordinate enhanced page creation with the mobile drawer's route behavior.
 * @param {{ isMobile: () => boolean, setSidebarOpen: (open: boolean) => void, onStart?: () => void }} options
 */
export function createSidebarCreateNavigation({ isMobile, setSidebarOpen, onStart }) {
	let preserveSidebarAfterCreate = false;

	/** @type {import('@sveltejs/kit').SubmitFunction} */
	const enhance = () => {
		preserveSidebarAfterCreate = isMobile();
		onStart?.();

		return async ({ result, update }) => {
			await update();
			if (result.type !== 'redirect') {
				preserveSidebarAfterCreate = false;
			}
			if (isMobile() && result.type === 'redirect') {
				setSidebarOpen(true);
			}
		};
	};

	function afterNavigate() {
		if (preserveSidebarAfterCreate) {
			preserveSidebarAfterCreate = false;
			if (isMobile()) setSidebarOpen(true);
		} else if (isMobile()) {
			setSidebarOpen(false);
		}
	}

	return { enhance, afterNavigate };
}
