import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createPage, getActivePages, getPageById, movePage, sendToTrash, updatePage, getTrashPages } from '$lib/server/pages';

export const GET: RequestHandler = async () => {
	const logs: string[] = [];
	const log = (msg: string) => {
		logs.push(msg);
		console.log(msg);
	};

	log('--- SvelteKit Database Verification Test ---');

	try {
		// 1. Create root pages
		log('1. Creating root pages...');
		const page1 = await createPage(null, 'Work Notebook 💼', '💼');
		const page2 = await createPage(null, 'Recipes 🍲', '🍲');
		log(`Created root pages: "${page1.title}" (ID: ${page1.id}), "${page2.title}" (ID: ${page2.id})`);

		// 2. Create nested child pages
		log('2. Creating child pages...');
		const child1 = await createPage(page2.id, 'Lasagna 🍝', '🍝');
		log(`Created child: "${child1.title}" (ID: ${child1.id}, Parent ID: ${child1.parentId})`);

		// 3. Get all active pages
		log('3. Fetching active pages...');
		const active = await getActivePages();
		log(`Active pages count: ${active.length}`);
		for (const p of active) {
			log(` - ID: ${p.id}, Parent: ${p.parentId}, Position: ${p.position}, Title: ${p.title} ${p.icon || ''}`);
		}

		// 4. Update page
		log('4. Updating page title...');
		const updated = await updatePage(child1.id, { title: 'Best Lasagna 🍝' });
		log(`Updated title: "${updated?.title}" (Revision: ${updated?.revision})`);

		// 5. Move page
		log('5. Moving child page to root...');
		await movePage(child1.id, null, 1);
		const moved = await getPageById(child1.id);
		log(`Moved page parent: ${moved?.parentId}, position: ${moved?.position}`);

		// 6. Send page to trash
		log('6. Trashing page...');
		await sendToTrash(page2.id);
		const trash = await getTrashPages();
		log(`Pages in trash: ${trash.length}`);
		for (const p of trash) {
			log(` - Trash ID: ${p.id}, Title: ${p.title}`);
		}

		log('Database verification successfully completed!');
		return json({ success: true, logs });
	} catch (err: any) {
		log(`ERROR: ${err.message}`);
		return json({ success: false, logs, error: err.message }, { status: 500 });
	}
};
