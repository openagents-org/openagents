"""Bounded conversation evidence for routing, without inferring an owner from recency."""
import json


HISTORY_MESSAGES = 6
HISTORY_MESSAGE_CHARS = 3000
LATEST_MESSAGE_CHARS = 12000


def bounded_text(value, limit):
    text = str(value or "")
    if len(text) <= limit:
        return text
    marker = "\n[...middle omitted...]\n"
    remaining = limit - len(marker)
    return text[:remaining // 2] + marker + text[-(remaining - remaining // 2):]


def routing_history(messages, sender, candidates):
    """Messages are chronological chat turns; candidates already passed access checks.

    A previous dispatch is evidence, not a new authorization or a permanent owner.
    Agent replies are explicitly distinguished from human requests in the prompt.
    """
    turns = []
    for message in messages[-HISTORY_MESSAGES:]:
        turn = {
            "sender": message["sender"],
            "sender_type": message["sender_type"],
            "content": bounded_text(message.get("content"), HISTORY_MESSAGE_CHARS),
        }
        targets = message.get("target_agents")
        if isinstance(targets, list):
            turn["dispatched_to"] = [name for name in targets if name in candidates]
        turns.append(turn)
    # For human follow-ups, use that human's previous request. Do not silently
    # inherit a different person's task merely because its agent replied last.
    previous = next((i for i in range(len(turns) - 1, -1, -1)
                     if turns[i]["sender_type"] == "human"
                     and (sender["sender_type"] != "human"
                          or turns[i]["sender"] == sender["sender"])), None)
    follow_up = None
    if previous is not None:
        follow_up = {
            "previous_request_index": previous,
            "dispatched_to": turns[previous].get("dispatched_to", []),
            "agents_who_spoke_after_request": list(dict.fromkeys(
                turn["sender"] for turn in turns[previous + 1:]
                if turn["sender_type"] == "agent" and turn["sender"] in candidates)),
        }
    return json.dumps({"turns": turns, "follow_up_evidence": follow_up}, ensure_ascii=False)
