from pathlib import Path
from app.ml_service import train_and_evaluate


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    dataset_path = root / "data" / "spam_dataset.csv"
    artifact_path = Path(__file__).resolve().parent / "spam_pipeline.joblib"

    csv_content = dataset_path.read_text(encoding="utf-8")
    artifact = train_and_evaluate(
        csv_content=csv_content,
        dataset_name=dataset_path.name,
        artifact_path=artifact_path,
    )

    print(f"Trained pipeline saved to {artifact_path}")
    print(f"Selected best model: {artifact['selected_model']}")
    for ev in artifact["evaluations"]:
        print(
            f" - {ev['model_name']}: Acc={ev['accuracy']:.4f}, "
            f"P={ev['precision_score']:.4f}, R={ev['recall_score']:.4f}, "
            f"F1={ev['f1_score']:.4f}, AUC={ev['roc_auc']:.4f}"
        )


if __name__ == "__main__":
    main()
