import json
import logging

from app.analytical_four.engine.analysis.models import StatisticsSummary



class BasicStatistics:
    def __init__(self):
        self.logger = logging.getLogger(f"{__name__}.BasicStatistics")

    def calculate_mean(self, data: list):
        """計算平均值"""
        self.logger.debug("計算平均值。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算平均值。")
            return 0
        self.logger.debug("平均值計算完成。")
        return sum(data) / len(data)

    def calculate_median(self, data: list):
        """計算中位數"""
        self.logger.debug("計算中位數。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算中位數。")
            return 0
        sorted_data = sorted(data)
        mid = len(sorted_data) // 2
        if len(sorted_data) % 2 == 1:
            self.logger.debug("中位數計算完成。")
            return sorted_data[mid]
        self.logger.debug("中位數計算完成。")
        return (sorted_data[mid - 1] + sorted_data[mid]) / 2

    def calculate_pop_std(self, data: list):
        """計算母體標準差"""
        self.logger.debug("計算母體標準差。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算母體標準差。")
            return 0
        mean = self.calculate_mean(data)
        squared_diffs = [(x - mean) ** 2 for x in data]
        self.logger.debug("母體標準差計算完成。")
        return self.calculate_mean(squared_diffs) ** 0.5
    
    def calculate_sample_std(self, data: list):
        """計算樣本標準差"""
        self.logger.debug("計算樣本標準差。")
        if not data or len(data) < 2:
            self.logger.warning("輸入數據不足，無法計算樣本標準差。")
            return 0
        mean = self.calculate_mean(data)
        squared_diffs = [(x - mean) ** 2 for x in data]
        self.logger.debug("樣本標準差計算完成。")
        return (sum(squared_diffs) / (len(data) - 1)) ** 0.5

    def calculate_cv(self, data: list):
        """計算變異係數"""
        self.logger.debug("計算變異係數。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算變異係數。")
            return 0
        mean = self.calculate_mean(data)
        if mean == 0:
            self.logger.warning("平均值為零，無法計算變異係數。")
            return 0
        self.logger.debug("變異係數計算完成。")
        return self.calculate_pop_std(data) / mean

    def calculate_min_max(self, data: list):
        """計算最小值和最大值"""
        self.logger.debug("計算最小值和最大值。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算最小值和最大值。")
            return 0, 0
        self.logger.debug("最小值和最大值計算完成。")
        return min(data), max(data)

    def calculate_iqr(self, data: list):
        """計算四分位距"""
        self.logger.debug("計算四分位距。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算四分位距。")
            return 0, 0, 0
        sorted_data = sorted(data)
        self.logger.debug("四分位距計算完成。")
        return (
            sorted_data[int(len(sorted_data) * 0.25)],
            sorted_data[int(len(sorted_data) * 0.5)],
            sorted_data[int(len(sorted_data) * 0.75)]
        )

    def calculate_bound(self, data: list):
        """計算四分位距上限和下限"""
        self.logger.debug("計算四分位距邊界。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算四分位距邊界。")
            return [0, 0]
        q1, _, q3 = self.calculate_iqr(data)
        upper_bound = q3 + 1.5 * (q3 - q1)
        lower_bound = q1 - 1.5 * (q3 - q1)
        self.logger.debug("四分位距邊界計算完成。")
        return upper_bound, lower_bound

    def calculate_skewness(self, data: list):
        """計算偏度"""
        self.logger.debug("計算偏度。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算偏度。")
            return [0, 0, 0]
        mean = self.calculate_mean(data)
        std = self.calculate_pop_std(data)
        if std == 0:
            self.logger.warning("標準差為零，無法計算偏度。")
            return [0, 0, 0, 0]
        M2 = sum((x - mean) ** 2 for x in data) / len(data)
        M3 = sum((x - mean) ** 3 for x in data) / len(data)
        skewness = M3 / std ** 3
        self.logger.debug("偏度計算完成。")
        return (skewness, M2, M3)

    def calculate_kurtosis(self, data: list):
        """計算峰度"""
        self.logger.debug("計算峰度。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算峰度。")
            return [0, 0]
        mean = self.calculate_mean(data)
        std = self.calculate_pop_std(data)
        if std == 0:
            self.logger.warning("標準差為零，無法計算峰度。")
            return [0, 0]
        M4 = sum((x - mean) ** 4 for x in data) / len(data)
        kurtosis = M4 / std ** 4 - 3
        self.logger.debug("峰度計算完成。")
        return (kurtosis, M4)

    def calculate_summary(self, data: list):
        """計算數據摘要"""
        self.logger.info("開始計算摘要統計量。")
        if not data:
            self.logger.warning("輸入數據為空，無法計算摘要統計量。")
            return {
                "mean": 0,
                "median": 0,
                "population_std": 0,
                "sample_std": 0,
                "cv": 0,
                "min": 0,
                "max": 0,
                "iqr": (0, 0, 0),
                "bound": (0, 0),
                "skewness": (0, 0, 0),
                "kurtosis": (0, 0),
                "count": 0
            }

        mean_val = self.calculate_mean(data)
        median_val = self.calculate_median(data)
        pop_std_val = self.calculate_pop_std(data)
        sample_std_val = self.calculate_sample_std(data)
        cv_val = self.calculate_cv(data)
        min_val, max_val = self.calculate_min_max(data)
        iqr_val = self.calculate_iqr(data)
        bound_val = self.calculate_bound(data)
        skewness_val = self.calculate_skewness(data)
        kurtosis_val = self.calculate_kurtosis(data)
        count_val = len(data)
        
        summary = StatisticsSummary(
            mean=mean_val,
            median=median_val,
            population_std=pop_std_val,
            sample_std=sample_std_val,
            cv=cv_val,
            min=min_val,
            max=max_val,
            iqr=iqr_val,
            bound=bound_val,
            skewness=skewness_val,
            kurtosis=kurtosis_val,
            count=count_val
        )
        
        self.logger.info("摘要統計量計算完成。")
        return summary


class CumulativeStatistics:
    def __init__(self):
        pass

    def calculate_mean(self, pre_mean: float, pre_count: int, new_data: list):
        """計算累積平均值"""
        new_count = len(new_data)
        if pre_count + new_count == 0:
            return 0
        total_sum = pre_mean * pre_count + sum(new_data)
        return total_sum / (pre_count + new_count)

    def calculate_median(self, pre_data: list, new_data: list):
        """計算累積中位數"""
        combined_data = sorted(pre_data + new_data)
        n = len(combined_data)
        if n == 0:
            return 0
        mid = n // 2
        if n % 2 == 1:
            return combined_data[mid]
        return (combined_data[mid - 1] + combined_data[mid]) / 2

    def calculate_std(self, pre_mean: float, pre_std: float, pre_count: int, new_data: list):
        """計算累積標準差"""
        new_count = len(new_data)
        if pre_count + new_count == 0:
            return 0
        new_mean = sum(new_data) / new_count if new_count > 0 else 0
        new_variance = sum((x - new_mean) ** 2 for x in new_data) / new_count if new_count > 0 else 0

        combined_mean = self.calculate_mean(pre_mean, pre_count, new_data)
        combined_variance = (
            (pre_count * (pre_std ** 2 + (pre_mean - combined_mean) ** 2) +
             new_count * (new_variance + (new_mean - combined_mean) ** 2)) /
            (pre_count + new_count)
        )
        return combined_variance ** 0.5

    def calculate_cv(self, pre_mean: float, pre_std: float, pre_count: int, new_data: list):
        """計算累積變異係數"""
        combined_mean = self.calculate_mean(pre_mean, pre_count, new_data)
        combined_std = self.calculate_std(pre_mean, pre_std, pre_count, new_data)
        if combined_mean == 0:
            return 0
        return combined_std / combined_mean

    def calculate_min_max(self, pre_min: float, pre_max: float, new_data: list):
        """計算累積最小值和最大值"""
        if not new_data:
            return pre_min, pre_max
        new_min = min(new_data)
        new_max = max(new_data)
        combined_min = min(pre_min, new_min) if pre_min is not None else new_min
        combined_max = max(pre_max, new_max) if pre_max is not None else new_max
        return combined_min, combined_max

    def calculate_percentiles(self, pre_data: list, new_data: list, p25: float, p75: float, p95: float):
        """計算累積百分位數"""
        combined_data = sorted(pre_data + new_data)
        n = len(combined_data)
        if n == 0:
            return 0, 0, 0
        return (
            combined_data[int(n * p25)],
            combined_data[int(n * p75)],
            combined_data[int(n * p95)]
        )

    def calculate_skewness(self, pre_mean: float, pre_count: int, pre_M2: float, pre_M3: float, new_data: list):
        """計算累積偏度"""
        new_count = len(new_data)
        if pre_count + new_count == 0:
            return 0, pre_mean, pre_M2, pre_M3

        new_mean = sum(new_data) / new_count if new_count > 0 else 0
        new_M2 = sum((x - new_mean) ** 2 for x in new_data)
        new_M3 = sum((x - new_mean) ** 3 for x in new_data)

        combined_count = pre_count + new_count

        delta = new_mean - pre_mean

        combined_M2 = pre_M2 + new_M2 + delta**2 * pre_count * new_count / combined_count
        combined_M3 = (pre_M3 + new_M3 +
                       delta**3 * pre_count * new_count * (pre_count - new_count) / combined_count**2 +
                       3 * delta * (pre_count * new_M2 - new_count * pre_M2) / combined_count)

        skewness = combined_M3 / combined_M2**1.5 if combined_M2 > 0 else 0

        return skewness, combined_M2, combined_M3

    def calculate_kurtosis(self, pre_mean: float, pre_count: int, pre_M2: float, pre_M3: float, pre_M4: float, new_data: list):
        """計算累積峰度"""
        new_count = len(new_data)
        if pre_count + new_count == 0:
            return 0, pre_mean, pre_M2, pre_M3, pre_M4

        new_mean = sum(new_data) / new_count if new_count > 0 else 0
        new_M2 = sum((x - new_mean) ** 2 for x in new_data)
        new_M3 = sum((x - new_mean) ** 3 for x in new_data)
        new_M4 = sum((x - new_mean) ** 4 for x in new_data)

        combined_count = pre_count + new_count
        delta = new_mean - pre_mean

        combined_M2 = pre_M2 + new_M2 + delta**2 * pre_count * new_count / combined_count
        combined_M3 = pre_M3 + new_M3 + delta**3 * pre_count * new_count * (pre_count - new_count) / combined_count**2 + 3 * delta * (pre_count * new_M2 - new_count * pre_M2) / combined_count
        combined_M4 = (pre_M4 + new_M4 +
                    delta**4 * pre_count * new_count * (pre_count**2 - pre_count*new_count + new_count**2) / combined_count**3 +
                    6 * delta**2 * (pre_count**2 * new_M2 + new_count**2 * pre_M2) / combined_count**2 +
                    4 * delta * (pre_count * new_M3 - new_count * pre_M3) / combined_count)

        kurtosis = combined_M4 / combined_M2**2 - 3 if combined_M2 > 0 else 0

        return kurtosis, combined_M2, combined_M3, combined_M4