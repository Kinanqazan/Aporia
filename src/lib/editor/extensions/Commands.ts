import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

export interface CommandsOptions {
	suggestion: Omit<Parameters<typeof Suggestion>[0], 'editor'>;
}

export const Commands = Extension.create<CommandsOptions>({
	name: 'commands',

	addOptions() {
		return {
			suggestion: {
				char: '/',
				command: ({ editor, range, props }) => {
					props.command({ editor, range });
				}
			}
		};
	},

	addProseMirrorPlugins() {
		return [
			Suggestion({
				editor: this.editor,
				...this.options.suggestion
			})
		];
	}
});

export default Commands;
