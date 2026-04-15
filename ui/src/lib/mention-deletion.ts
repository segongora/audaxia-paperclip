import { createRootEditorSubscription$, realmPlugin } from "@mdxeditor/editor";
import {
  COMMAND_PRIORITY_CRITICAL,
  KEY_BACKSPACE_COMMAND,
  DELETE_CHARACTER_COMMAND,
  $getSelection,
  $isRangeSelection,
} from "lexical";
import { $isLinkNode } from "@lexical/link";

const MENTION_SCHEMES = ["agent://", "project://", "skill://"];

function isMentionUrl(url: string): boolean {
  return MENTION_SCHEMES.some((scheme) => url.startsWith(scheme));
}

/**
 * MDXEditor/Lexical plugin that handles deletion of mention chips as atomic
 * units. When the caret is immediately after a mention link and the user
 * presses Backspace, the entire mention node is removed.
 */
export const mentionDeletionPlugin = realmPlugin({
  init(realm) {
    realm.pub(createRootEditorSubscription$, [
      (editor) => {
        const unregBackspace = editor.registerCommand(
          KEY_BACKSPACE_COMMAND,
          () => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

            const anchor = selection.anchor;
            const offset = anchor.offset;
            if (offset !== 0) return false;

            const anchorNode = anchor.getNode();
            const prev = anchorNode.getPreviousSibling();
            if ($isLinkNode(prev) && isMentionUrl(prev.getURL())) {
              prev.remove();
              return true;
            }

            return false;
          },
          COMMAND_PRIORITY_CRITICAL,
        );

        const unregDelete = editor.registerCommand(
          DELETE_CHARACTER_COMMAND,
          (isBackward) => {
            if (isBackward) return false;

            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

            const anchor = selection.anchor;
            const anchorNode = anchor.getNode();
            const offset = anchor.offset;
            const textContent = anchorNode.getTextContent();
            if (offset !== textContent.length) return false;

            const next = anchorNode.getNextSibling();
            if ($isLinkNode(next) && isMentionUrl(next.getURL())) {
              next.remove();
              return true;
            }

            return false;
          },
          COMMAND_PRIORITY_CRITICAL,
        );

        return () => {
          unregBackspace();
          unregDelete();
        };
      },
    ]);
  },
});
