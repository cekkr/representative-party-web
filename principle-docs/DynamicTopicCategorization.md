For a platform that needs to not just *sort* content but *reorganize* it intelligently over time (refactoring), you cannot rely on a static classification model. You need a **Dynamic "Gardener" Algorithm**.

This algorithm actively maintains the topic tree: it plants new seeds (incoming topics), prunes dead branches (irrelevant data), and grafts similar branches together (merging topics).

###I. The Optimal Algorithm: "The Recursive Gardener"The best approach combines **Online Hierarchical Clustering** with a **Periodic LLM Refactoring Loop**.

####Phase 1: The Stream (Real-time Ingestion)Don't rebuild the tree for every comment. Use an **Incremental Learning** approach.

* **Model:** **Online BERTopic** (backed by `River` or `MiniBatchKMeans`).
* **Action:** When a user posts, the system calculates its embedding (using `nomic-embed-text`) and assigns it to the nearest existing *micro-cluster*. If it's too far from any cluster, it creates a new temporary outlier bucket.
* **Result:** Fast, low-latency categorization for the user immediately.

####Phase 2: The Refactoring (The "Gardener" Agent)This is the "Refactoring" logic you asked about. It runs asynchronously (e.g., every night or when a topic reaches 100+ items).

**The Algorithm Logic:**

1. **Snapshot:** Freeze the current topic tree.
2. **Audit (The "Judge"):** An LLM (like **DeepSeek-R1** or **Llama 3.1**) scans the tree structure.
* *Check for Duplicates:* "Are 'Fiscal Policy' and 'Government Spending' separate branches? They share 80% of the same sub-topics. Suggest Merge."
* *Check for Over-saturation:* "The 'Social Issues' branch has 5,000 items. It is too broad. Suggest Split into 'Civil Rights', 'Healthcare', and 'Immigration'."


3. **Execute Refactor:**
* **Merge:** Combine vectors of two clusters and recalculate the centroid.
* **Split:** Run a sub-clustering algorithm (K-Means) *only* on the documents inside the over-saturated topic.


4. **Re-Label:** Ask the LLM to generate a new label for the altered branches.

###II. Do you need External References (Wikipedia)?**Short Answer:** You do not *need* them to function, but you **should** use them for **Validation (Grounding)**.

If you rely solely on internal data, your model might create "echo chamber" categories that make sense to your users but look weird to outsiders (e.g., categorizing "Vaccines" under "Government Control" instead of "Public Health" because that's how your users talk about it).

**How to use Wikipedia as a "Ground Truth" Anchor:**

1. **NPMI (Normalized Pointwise Mutual Information):**
* This is the standard scientific metric for topic quality. It checks if the words in your generated topic (e.g., "tax", "bracket", "deduction") actually appear together in Wikipedia articles.
* *If NPMI is low:* Your topic is likely incoherent or noise. The system should dissolve it.


2. **Ontology Snapping:**
* When the LLM creates a label, force it to cross-reference Wikipedia's Category Graph.
* *Prompt:* "You identified a cluster about 'coins, blockchain, mining'. Map this to the closest existing Wikipedia Category."
* *Result:* The system adopts the standardized term **"Cryptocurrency"** instead of a vague user-generated term like "Crypto stuff".



###III. Python Implementation Strategy (Concept)You can build the "Gardener" using **BERTopic**'s dynamic features and a custom LLM loop.

```python
from bertopic import BERTopic
from river import cluster
from sklearn.feature_extraction.text import CountVectorizer

# 1. SETUP: Online Learning Model (The Stream)
# Uses a streaming clustering algorithm (River) to handle data as it arrives
topic_model = BERTopic(
    hdbscan_model=cluster.DBSTREAM(clustering_threshold=0.5),
    vectorizer_model=CountVectorizer(stop_words="english"),
    calculate_probabilities=True
)

# 2. INGEST: Feed data one by one (or mini-batches)
def on_new_user_post(text_document):
    # This updates the micro-clusters in real-time
    topic_model.partial_fit([text_document]) 
    return topic_model.transform([text_document])

# 3. THE GARDENER: Refactoring Logic (Run Periodically)
def refactor_tree(topic_model, llm_judge):
    topics_info = topic_model.get_topic_info()
    
    # Step A: Identify Redundancy using embeddings similarity
    # Calculate similarity between all topic centroids
    distance_matrix = topic_model.topic_embeddings_ @ topic_model.topic_embeddings_.T
    
    # Step B: LLM Decision
    for topic_pair in find_close_pairs(distance_matrix):
        decision = llm_judge.ask(f"Should '{topic_pair.A}' and '{topic_pair.B}' be merged?")
        
        if decision == "MERGE":
            topic_model.merge_topics([topic_pair.A, topic_pair.B])
            print(f"Refactored: Merged {topic_pair.A} and {topic_pair.B}")
            
    # Step C: Update Hierarchy Labels
    topic_model.set_topic_labels(llm_judge.generate_new_labels(topic_model))

```

###IV. Visualizing the "Refactoring"To help users understand *why* the structure changed, your website should visualize the history.

**Diagram Explanation:**

* **T0 (Start):** Topics are scattered points.
* **T1 (Clustering):** Points group into "Tax", "Spend", "School", "Teacher".
* **T2 (Refactoring/Hierarchy):** The "Gardener" recognizes relationships.
* "Tax" + "Spend" \rightarrow merged under parent **"Economics"**.
* "School" + "Teacher" \rightarrow merged under parent **"Education"**.



###Summary of Recommendation1. **Algorithm:** **Online BERTopic** for ingestion + **LLM-driven Merge/Split** for maintenance.
2. **External Ref:** Use **Wikipedia** via **NPMI metrics** to validate that your topics are coherent, but don't require it for the live clustering process.
3. **Hardware:** Run the "Gardener" process on a schedule (cron job) so it doesn't slow down the live website.

# Practical example reference

To solve the "Revolution vs. Evolution" problem, we need a system that **separates ingestion from maintenance**.

If you re-cluster everything every hour ("Revolution"), user trust breaks because the "Economy" topic they were following suddenly disappears. Instead, we use an **Online Stream** for instant categorization and a **Background Gardener** for slow, safe evolution.

###The Architecture1. **The Database (SQLite):** The "Source of Truth." It persists the Topic Tree and the Documents.
2. **The Stream (Online BERTopic):** Handles new posts in real-time (O(1) complexity). It never deletes topics, only creates or assigns.
3. **The Gardener (Maintenance Script):** Runs periodically. It looks *only* for mathematically obvious merges (Evolution). It uses the Database to fetch documents only when a merge is necessary.

###The Exhaustive Python ExampleThis code simulates the entire lifecycle. You can run this locally.

**Prerequisites:** `pip install bertopic river sqlalchemy pandas`

```python
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, Text
from sqlalchemy.orm import declarative_base, sessionmaker
from bertopic import BERTopic
from river import cluster
from sklearn.feature_extraction.text import CountVectorizer

# ==========================================
# 1. THEORETICAL DATABASE (The "Memory")
# ==========================================
# We use SQLite for this example, but this represents your Production DB
Base = declarative_base()

class TopicTable(Base):
    __tablename__ = 'topics'
    id = Column(Integer, primary_key=True) # The Topic ID from BERTopic
    label = Column(String)                 # Human readable label (e.g., "Fiscal Policy")
    parent_id = Column(Integer, nullable=True) # For the Hierarchy Tree
    status = Column(String)                # 'active', 'merged', 'deprecated'

class DocumentTable(Base):
    __tablename__ = 'documents'
    id = Column(Integer, primary_key=True)
    content = Column(Text)
    topic_id = Column(Integer, ForeignKey('topics.id')) # Link to Topic

# Setup DB
engine = create_engine('sqlite:///political_forum.db')
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
db = Session()

# ==========================================
# 2. THE SYSTEM (Class Wrapper)
# ==========================================
class PoliticalTopicEngine:
    def __init__(self):
        # A. Online Model Setup (The "Stream")
        # We use River for streaming clustering so we don't need to retrain
        # simple_hdbscan is not online, so we wrap a River model
        self.cluster_model = cluster.DBSTREAM(
            clustering_threshold=0.7, # Higher = harder to create new clusters (conservatism)
            fading_factor=0.01        # Forget very old, irrelevant outliers slowly
        )
        
        # B. Vectorizer (Incremental)
        vectorizer_model = CountVectorizer(stop_words="english")
        
        # C. The BERTopic Instance
        self.topic_model = BERTopic(
            hdbscan_model=self.cluster_model,
            vectorizer_model=vectorizer_model,
            calculate_probabilities=True,
            verbose=False
        )
        
        # Cold start: We need a tiny bit of data to "init" the vectorizers
        # In a real app, you load a pre-trained model. Here we simulate a cold start.
        self.is_initialized = False

    def ingest_post(self, text):
        """
        Phase 1: Real-time Ingestion (No Revolution)
        """
        session = Session()
        
        if not self.is_initialized:
            # First run initialization (simulation only)
            self.topic_model.fit([text]*15) # Fake fit to init structure
            self.is_initialized = True
            topic_id = 0
        else:
            # 1. Partial Fit (Update internal state without reshuffling)
            self.topic_model.partial_fit([text])
            
            # 2. Transform (Get the topic ID for this specific text)
            topic_id, _ = self.topic_model.transform([text])
            topic_id = topic_id[0] # Extract from list

        # 3. Save to DB
        # If topic is new (-1 usually means outlier, but in River it handles new IDs)
        if topic_id != -1:
            self._ensure_topic_in_db(topic_id, session)
        
        new_doc = DocumentTable(content=text, topic_id=topic_id)
        session.add(new_doc)
        session.commit()
        session.close()
        
        return topic_id

    def _ensure_topic_in_db(self, topic_id, session):
        exists = session.query(TopicTable).filter_by(id=int(topic_id)).first()
        if not exists:
            # Generate a temporary label
            # In production, you'd use LLM here: generate_topic_label(keywords)
            topic_info = self.topic_model.get_topic(topic_id)
            if topic_info:
                top_words = "_".join([word[0] for word in topic_info[:3]])
                label = f"{top_words}"
            else:
                label = f"New_Topic_{topic_id}"
                
            new_topic = TopicTable(id=int(topic_id), label=label, status='active')
            session.add(new_topic)

# ==========================================
# 3. THE GARDENER (The "Evolution" Logic)
# ==========================================
def run_gardener_cycle(engine, topic_model):
    """
    Phase 2: Evolution. Runs explicitly (e.g., Cron Job).
    This simulates 'refactoring' the tree without breaking user links.
    """
    print("\n--- 🌿 Gardener: Starting Maintenance Cycle ---")
    session = Session()
    
    # Step A: Get all active topics
    active_topics = session.query(TopicTable).filter_by(status='active').all()
    if len(active_topics) < 2:
        print("Not enough topics to merge.")
        return

    # Step B: Calculate Similarity Matrix between Topics
    # We use BERTopic's internal c-TF-IDF embeddings
    # (In production, use topic_model.topic_embeddings_)
    
    # ...Simulating similarity check for the example...
    # Let's say we found Topic 1 and Topic 2 are 95% similar
    # In real code: cosine_similarity(topic_model.topic_embeddings_)
    
    # MOCK DECISION: "The gardener found a merge candidate"
    # Let's pretend we identified Topic 0 and Topic 1 should merge
    topic_a_id = active_topics[0].id
    topic_b_id = active_topics[1].id
    
    # Verify they are actually distinct in our DB
    if topic_a_id == topic_b_id: 
        return

    print(f"🌿 Gardener: Detected similarity between '{active_topics[0].label}' and '{active_topics[1].label}'")
    
    # Step C: The "Soft" Merge (Evolution)
    # We do NOT delete the old topics immediately. We create a Parent.
    
    # 1. Create Parent Topic
    parent_label = f"Category: {active_topics[0].label.split('_')[0]} & {active_topics[1].label.split('_')[0]}"
    parent_id = 9900 + topic_a_id # Arbitrary ID generation logic
    
    parent_topic = TopicTable(id=parent_id, label=parent_label, status='active', parent_id=None)
    session.add(parent_topic)
    
    # 2. Update Children (Move them under the new parent)
    active_topics[0].parent_id = parent_id
    active_topics[1].parent_id = parent_id
    
    print(f"🌿 Gardener: Evolved Tree. Created Parent '{parent_label}' -> containing IDs {topic_a_id}, {topic_b_id}")
    
    # Step D: (Optional) Hard Merge
    # If similarity > 0.98, we might physically merge them in BERTopic
    # Note: merge_topics requires documents. We fetch them from DB.
    # docs = session.query(DocumentTable.content).filter(DocumentTable.topic_id.in_([topic_a_id, topic_b_id])).all()
    # topic_model.merge_topics([d.content for d in docs], [topic_a_id, topic_b_id])
    
    session.commit()
    session.close()

# ==========================================
# 4. EXECUTION SIMULATION
# ==========================================
if __name__ == "__main__":
    system = PoliticalTopicEngine()
    
    # --- Time Step 1: Ingest Initial Discussions ---
    print("--- 🟢 Day 1: Users discussing Taxes ---")
    taxes_posts = [
        "The government should lower income tax.",
        "Taxation is theft, we need less spending.",
        "Fiscal policy is ruining the middle class.",
        "High taxes on corporations are necessary."
    ]
    for p in taxes_posts:
        tid = system.ingest_post(p)
        print(f"Posted: '{p[:30]}...' -> Assigned Topic {tid}")

    # --- Time Step 2: Ingest Different Discussions ---
    print("\n--- 🔵 Day 2: Users discussing Schools ---")
    school_posts = [
        "Teachers need higher pay immediately.",
        "The school curriculum is outdated.",
        "Education funding should be priority.",
        "University tuition is too high."
    ]
    for p in school_posts:
        tid = system.ingest_post(p)
        print(f"Posted: '{p[:30]}...' -> Assigned Topic {tid}")

    # --- Time Step 3: The Gardener Runs (Nightly) ---
    # It will detect if "Taxes" (Topic 0) and "Schools" (Topic 1) share a parent
    # Or if "Income Tax" and "Corp Tax" should merge.
    run_gardener_cycle(engine, system.topic_model)

    # --- Visualization of the Tree ---
    print("\n--- 🌳 Current Category Tree ---")
    session = Session()
    topics = session.query(TopicTable).all()
    for t in topics:
        indent = "  " if t.parent_id else ""
        icon = "📂" if t.parent_id is None and len(topics) > 2 else "📄"
        parent_info = f"(Child of {t.parent_id})" if t.parent_id else "(Root)"
        print(f"{indent}{icon} [{t.id}] {t.label} {parent_info}")

```

###Why this addresses your constraints1. **No Revolution:**
* The `ingest_post` function uses `partial_fit`. This is "Online Learning". It respects the existing cluster centroids and only tweaks them slightly. It does not re-calculate the whole universe.


2. **Theoretical Database:**
* We use SQLAlchemy (`TopicTable`, `DocumentTable`) to decouple the storage from the AI model. If the AI model crashes or is swapped, your Topic IDs and User relationships remain in the SQL database.


3. **Step-by-Step Evolution:**
* The `run_gardener_cycle` demonstrates the "Soft Merge". Instead of destroying Topic A and B and creating C (which confuses users), it creates a **Parent C** and moves A and B inside it.
* Users still see their original topic ("Teachers"), but now it sits inside a cleaner hierarchy ("Education").



###External Validation (Wikipedia)To implement the Wikipedia check you asked for, you would insert it inside `_ensure_topic_in_db`:

```python
# Pseudo-code for Validation
def validate_with_wikipedia(topic_keywords):
    # Search Wikipedia API
    wiki_result = wikipedia.search(topic_keywords)
    if not wiki_result:
        return "Uncategorized / Noise"
    return wiki_result[0] # Returns "Taxation" instead of "money stealing gov"

```

You place this logic in the "Gardener" phase so it doesn't slow down the real-time posting.

[Analyzing topic modeling performance with BERTopic](https://www.google.com/search?q=https://www.youtube.com/watch%3Fv%3DwX-dJvG0uFc)

This video is relevant because it dives into evaluating the stability and coherence of topics generated by BERTopic, which is critical when you are building a system that evolves over time without "revolution."