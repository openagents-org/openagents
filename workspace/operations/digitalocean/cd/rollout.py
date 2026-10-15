"""Rolling deployment policy. Dependencies are injected for deterministic failure tests."""

class RolloutError(RuntimeError):
    pass


def rollout(nodes, balancer, image, migrate, verify_public, record, settle):
    """Update secondary then primary; keep a verified peer available throughout.

    Migrations must be explicitly backward compatible. Rollback changes images,
    never database schema or data. Failed rollback nodes remain out of the pool.
    """
    before = {n.name: n.status() for n in nodes}
    for n in nodes:
        if not before[n.name]['ready']:
            raise RolloutError('Both nodes must be ready before deployment')
        n.validate(image)
    if not balancer.contains_all(nodes):
        raise RolloutError('Expected both backend nodes in the load balancer')
    migrate()
    changed = []
    try:
        for n in nodes:
            peer = next(other for other in nodes if other is not n)
            if not peer.status()['ready']:
                raise RolloutError('Peer is not ready; refusing to drain node')
            changed.append(n)  # include partial failures during drain/activation
            balancer.remove(n)
            n.route('peer')
            settle('drain')
            n.activate(image)
            n.verify()
            n.route('local')
            balancer.add(n)
            settle('healthy')
        verify_public()
    except Exception as original:
        failed = []
        # Restore a healthy old-image node first; it can serve its peer's rollback.
        for n in reversed(changed):
            try:
                peer = next(other for other in nodes if other is not n)
                if not peer.status()['ready']:
                    raise RolloutError('No healthy peer for rollback')
                balancer.remove(n)
                n.route('peer')
                settle('drain')
                n.activate(before[n.name]['image'])
                n.verify()
                n.route('local')
                balancer.add(n)
                settle('healthy')
            except Exception:
                failed.append(n.name)
        record({'status': 'rollback_failed' if failed else 'rolled_back',
                'image': image, 'failed_nodes': failed})
        raise RolloutError('Deployment failed; rollback failed on ' + ','.join(failed)
                           if failed else 'Deployment failed; previous images restored') from original
    record({'status': 'deployed', 'image': image})
