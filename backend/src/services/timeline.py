# backend/src/services/timeline.py
"""
Git-based version control for CAD models.
Each model_id gets its own version history.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime

import git


class CADTimeline:
    """Manages git-based version history for a single CAD model directory."""
    
    def __init__(self, repo_path: Path):
        self.repo_path = repo_path
        # Initialize a git repo if one doesn't exist
        if not os.path.exists(os.path.join(repo_path, '.git')):
            self.repo = git.Repo.init(repo_path)
            # Configure git user for commits
            self.repo.config_writer().set_value("user", "name", "AgentFix").release()
            self.repo.config_writer().set_value("user", "email", "agentfix@local").release()
        else:
            self.repo = git.Repo(repo_path)
    
    def save_revision(self, message: str, files: Optional[List[str]] = None) -> str:
        """
        Commits the current state of files to the timeline.
        Returns the commit hash.
        """
        if files:
            self.repo.index.add(files)
        else:
            # Add all changes
            self.repo.git.add(A=True)
        
        commit = self.repo.index.commit(message)
        print(f"[Timeline] Revision saved: {commit.hexsha[:8]} - {message}", flush=True)
        return commit.hexsha
    
    def get_history(self) -> List[Dict]:
        """
        Returns a list of all versions with their metadata.
        Sorted from oldest to newest.
        """
        commits = list(self.repo.iter_commits())
        commits.reverse()  # oldest first
        
        versions = []
        for i, commit in enumerate(commits, start=1):
            versions.append({
                "version": i,
                "commit_hash": commit.hexsha,
                "message": commit.message.strip(),
                "timestamp": datetime.fromtimestamp(commit.committed_date).isoformat(),
            })
        return versions
    
    def revert_to(self, commit_hash: str) -> None:
        """
        Hard resets to a specific commit, discarding all commits after it.
        This is destructive - newer versions will be lost.
        """
        self.repo.git.reset('--hard', commit_hash)
        print(f"[Timeline] Reverted to {commit_hash[:8]}", flush=True)
    
    def checkout_version(self, commit_hash: str) -> None:
        """
        Checkout files from a specific commit WITHOUT modifying history.
        This is non-destructive - you can checkout any version and then
        go back to newer versions.
        """
        self.repo.git.checkout(commit_hash, '--', '.')
        print(f"[Timeline] Checked out files from {commit_hash[:8]}", flush=True)
    
    def save_revision_from(self, from_commit_hash: str, message: str, files: Optional[List[str]] = None) -> str:
        """
        Save a revision when editing from a specific version.
        If from_commit_hash is not the latest, first truncate history to that commit,
        then save the new revision.
        """
        # Check if we need to truncate history
        head_commit = self.repo.head.commit.hexsha
        if from_commit_hash != head_commit:
            # Truncate: reset to the version we're editing from
            self.revert_to(from_commit_hash)
            print(f"[Timeline] Truncated history to {from_commit_hash[:8]} before saving", flush=True)
        
        # Now save the new revision
        return self.save_revision(message, files)
    
    def get_current_version(self) -> Optional[Dict]:
        """Returns the current (HEAD) version info."""
        try:
            commit = self.repo.head.commit
            history = self.get_history()
            for v in history:
                if v["commit_hash"] == commit.hexsha:
                    return v
            return None
        except git.exc.InvalidGitRepositoryError:
            return None


# Global registry of timelines per model_id
_timelines: Dict[str, CADTimeline] = {}


def get_timeline(model_id: str, model_dir: Path) -> CADTimeline:
    """Get or create a timeline for a model."""
    if model_id not in _timelines:
        _timelines[model_id] = CADTimeline(model_dir)
    return _timelines[model_id]


def get_model_versions(model_id: str) -> List[Dict]:
    """Get version history for a model. Returns empty list if not found."""
    if model_id in _timelines:
        return _timelines[model_id].get_history()
    return []


def clear_timeline(model_id: str) -> None:
    """Remove timeline from registry (e.g., when model is deleted)."""
    if model_id in _timelines:
        del _timelines[model_id]
