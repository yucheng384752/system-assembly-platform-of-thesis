"""把產線定義檔寫入資料庫（可重複執行，只新增不覆蓋）。

先以 seed_check 驗證；有錯誤就整份不寫入。已存在的產線、站點、項目、步驟保持原樣，
避免重新部署時蓋掉使用者之後在介面上調整過的值。
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.seed_check import check_seed
from app.models.metric import Metric
from app.models.product_line import ProductLine
from app.models.station import Station
from app.models.station_step import StationStep


class SeedError(ValueError):
    pass


async def apply_seed(db: AsyncSession, doc: dict) -> dict[str, int]:
    errors = check_seed(doc)
    if errors:
        raise SeedError("產線定義檔不合法：" + "；".join(errors))
    added = {"lines": 0, "stations": 0, "metrics": 0, "steps": 0}
    for line_doc in doc["productLines"]:
        line = await db.scalar(select(ProductLine).where(ProductLine.code == line_doc["code"]))
        if line is None:
            line = ProductLine(code=line_doc["code"], name=line_doc["name"], status=line_doc["status"])
            db.add(line)
            await db.flush()
            added["lines"] += 1
        for st_doc in line_doc.get("stations", []):
            station = await db.scalar(select(Station).where(Station.product_line_id == line.id, Station.code == st_doc["code"]))
            if station is None:
                station = Station(product_line_id=line.id, code=st_doc["code"], name=st_doc["name"], sequence=st_doc["sequence"])
                db.add(station)
                await db.flush()
                added["stations"] += 1
            for order, m in enumerate(st_doc.get("metrics", [])):
                exists = await db.scalar(select(Metric.id).where(Metric.station_id == station.id, Metric.key == m["key"], Metric.product_model_id.is_(None)))
                if exists is None:
                    db.add(Metric(station_id=station.id, section=m.get("section", st_doc["name"]), scope=m.get("scope", "station"),
                                  key=m["key"], label=m["label"], unit=m.get("unit"), data_type=m["dataType"],
                                  spec_min=m.get("specMin"), spec_max=m.get("specMax"), spec_text=m.get("specText"),
                                  spec_source=m.get("specSource", "constant"), filler_role=m.get("fillerRole", "operator"),
                                  display_order=order, required=m.get("required", False), hidden_from_roles=m.get("hiddenFromRoles", [])))
                    added["metrics"] += 1
            for step in st_doc.get("steps", []):
                variant = step.get("variant")
                exists = await db.scalar(select(StationStep.id).where(StationStep.station_id == station.id, StationStep.seq == step["seq"], StationStep.variant.is_(None) if variant is None else StationStep.variant == variant))
                if exists is None:
                    db.add(StationStep(station_id=station.id, variant=variant, seq=step["seq"], instruction=step["instruction"],
                                       spec_text=step.get("specText"), expected=step.get("expected", {})))
                    added["steps"] += 1
    await db.commit()
    return added
